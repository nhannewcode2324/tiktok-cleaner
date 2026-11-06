import type { ActionResult, LikeFlowStage } from '../shared/types';
import {
  detectCaptcha,
  detectHttp403,
  detectOffline,
  detectRateLimit,
  detectUnavailable,
  isVisible,
  qsa,
} from './dom-observer';
import { normalizeText } from '../shared/utils';
import {
  getActionAbortSignal,
  isActionAborted,
  sleepUnlessActionAborted,
} from './abort-signal';

/**
 * Like Handler for TikTok Web — Explicit State-Machine & MutationObserver Engine.
 *
 * State Machine Flow:
 * `OPENING → WAITING_FOR_VIDEO → WAITING_FOR_LIKE_BUTTON → CHECKING_LIKE → UNLIKING → VERIFYING → SUCCESS / FAILED / UNVERIFIED / SKIPPED`
 *
 * Core anti-premature-SKIPPED & anti-re-like guarantees (combining patterns from
 * `lefewix/tiktok-mass-unliker` and `TahaGorme/InstaMassUnliker`):
 * 1. Never marks `SKIPPED` when the video/viewer has not finished loading or the Like button is missing.
 * 2. Uses `MutationObserver` + media readiness events (`loadedmetadata`, `loadeddata`, `canplay`) +
 *    bounded retries to wait for the active viewer container, video element, and Like button.
 * 3. Multi-sample hydration guard in `CHECKING_LIKE`: TikTok modals frequently mount the Like button
 *    in a default unliked state (`aria-pressed="false"` or white outline SVG) for 300–1500ms before
 *    hydrating `digged: true`. `CHECKING_LIKE` observes mutations across `unlikedConfirmWaitMs` and
 *    immediately catches delayed `false → true` hydration instead of prematurely skipping.
 * 4. Marks `UNVERIFIED` (never `SKIPPED`) whenever the Like button cannot be located or its state
 *    remains indeterminate (`null`).
 * 5. Strictly clicks ONCE per video (`clickedOnce` + `inFlightLikeVideos` deduplication lock) and
 *    verifies `true → false` transition + rollback stability before moving to the next video.
 */

export const BROWSE_SELECTORS = [
  'div[data-e2e="browse-video"]',
  'div[data-e2e="browse-container"]',
  '[data-e2e="browse-video-container"]',
  '#main-content-video_detail',
  'div[class*="DivBrowserModeContainer"]',
  'div[class*="DivVideoDetailContainer"]',
] as const;

export const FEED_SELECTORS = [
  'div[data-e2e="recommend-list-item-container"]',
  'div[data-e2e="feed-video"]',
] as const;

export const CONTAINER_SELECTORS = [...BROWSE_SELECTORS, ...FEED_SELECTORS] as const;

const COMMENT_ZONE_SEL =
  '[data-e2e*="comment" i], [class*="Comment" i], [data-e2e*="reply" i], [class*="ReplyAction" i]';

/** Matches `like-icon`, `browse-like-icon`, `unlike-icon`, `video-like-icon`, `like-button`; excludes `browse-like-count`. */
const LIKE_E2E_RE = /(^|-)(un)?like(-icon|-button)?$/i;

/** Strict TikTok active heart brand red (`#fe2c55` / `rgb(254, 44, 85)`). Never matches `rgba(254, 254, 254, 1)`. */
const TIKTOK_RED_RE =
  /(#fe2c55\b|#ff2c55\b|#ff3b5c\b|rgba?\(\s*(?:254\s*,\s*44\s*,\s*85|255\s*,\s*44\s*,\s*85|255\s*,\s*59\s*,\s*92)\s*[,)])/i;

/**
 * Explicit white/near-white unliked heart fills on TikTok's action rail.
 * Intentionally excludes `#161823` / `rgb(0,0,0)` / `stroke` values so unstyled/hydrating SVGs
 * return `null` (indeterminate) instead of false-negative `false`.
 */
const NEUTRAL_HEART_FILL_RE =
  /(#fff(?:fff)?\b|rgba?\(\s*(?:255\s*,\s*255\s*,\s*255|254\s*,\s*254\s*,\s*254)\s*[,)])/i;

const MIN_CONTAINER_AREA = 4000;

/** Prevents concurrent duplicate execution on the same videoId. */
const inFlightLikeVideos = new Set<string>();

export function inComments(el: Element | null | undefined): boolean {
  if (!el) return false;
  return Boolean(el.closest(COMMENT_ZONE_SEL));
}

/**
 * Computes viewport-intersected visible pixel area of `el`.
 * In headless jsdom (where `document.body` has `0x0` layout unless mocked), falls back
 * to `isVisible(el)` so unit tests work with or without mocked `getBoundingClientRect`.
 */
export function visibleArea(el: Element | null | undefined): number {
  if (!el || !(el as HTMLElement).isConnected) return 0;
  const h = el as HTMLElement;
  const doc = h.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const style = win.getComputedStyle?.(h);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
    return 0;
  }

  const r = h.getBoundingClientRect();
  const hasMockedOrRealRect = r.width > 0 || r.height > 0 || r.top !== 0 || r.left !== 0;
  const bodyRect = doc.body?.getBoundingClientRect();
  const hasBrowserLayout = Boolean(bodyRect && (bodyRect.width > 0 || bodyRect.height > 0));

  if (!hasMockedOrRealRect && !hasBrowserLayout) {
    return isVisible(h) ? 100_000 : 0;
  }

  const vw = win.innerWidth || bodyRect?.width || 1280;
  const vh = win.innerHeight || bodyRect?.height || 800;
  const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
  const hPx = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  return w * hPx;
}

export function viewerKind(doc: Document = document): 'browse' | 'feed' | null {
  for (const sel of BROWSE_SELECTORS) {
    if (qsa(sel, doc).some((el) => visibleArea(el) > MIN_CONTAINER_AREA)) {
      return 'browse';
    }
  }
  for (const sel of FEED_SELECTORS) {
    if (qsa(sel, doc).some((el) => visibleArea(el) > MIN_CONTAINER_AREA)) {
      return 'feed';
    }
  }
  return null;
}

/**
 * Returns all currently visible video viewer containers, largest on-screen first.
 * Handles TikTok's split desktop layout where `browse-video` wraps `<video>` and
 * `#main-content-video_detail` or `DivBrowserModeContainer` wraps the sibling action rail.
 */
export function activeContainers(doc: Document = document): HTMLElement[] {
  const kind = viewerKind(doc);
  const selectors = kind === 'browse' ? BROWSE_SELECTORS : CONTAINER_SELECTORS;
  const seen = new Set<HTMLElement>();
  const scored: Array<{ el: HTMLElement; area: number }> = [];

  for (const sel of selectors) {
    for (const el of qsa<HTMLElement>(sel, doc)) {
      if (seen.has(el)) continue;
      const area = visibleArea(el);
      if (area > MIN_CONTAINER_AREA) {
        seen.add(el);
        scored.push({ el, area });
      }
    }
  }

  scored.sort((a, b) => b.area - a.area);
  return scored.map((s) => s.el);
}

function resolveButtonTarget(el: Element, roots: ParentNode[]): HTMLElement {
  const btn = el.closest('button, [role="button"]') as HTMLElement | null;
  if (btn && !inComments(btn) && roots.some((r) => r.contains(btn))) {
    return btn;
  }
  return el as HTMLElement;
}

/**
 * Finds the video-level Like button strictly inside active viewer containers.
 * Never falls back to `document` and never matches comment hearts or like-count nodes.
 */
export function findLikeButton(explicitRoot?: ParentNode | null): HTMLElement | null {
  const roots: ParentNode[] = explicitRoot ? [explicitRoot] : activeContainers(document);
  if (roots.length === 0) return null;

  // 1. Primary TikTok data-e2e hooks
  for (const root of roots) {
    const primary = qsa('[data-e2e="browse-like-icon"], [data-e2e="like-icon"]', root);
    for (const el of primary) {
      if (inComments(el) || !isVisible(el)) continue;
      return resolveButtonTarget(el, roots);
    }
  }

  // 2. Scoped data-e2e pattern (`*-like-icon`, `*-unlike-icon`, `*-like-button`, excluding counts & comments)
  for (const root of roots) {
    const candidates = qsa('[data-e2e]', root);
    for (const el of candidates) {
      if (inComments(el) || !isVisible(el)) continue;
      const e2e = el.getAttribute('data-e2e') || '';
      if (LIKE_E2E_RE.test(e2e) && !/count|comment/i.test(e2e)) {
        return resolveButtonTarget(el, roots);
      }
    }
  }

  // 3. Accessible button aria-label / title inside active viewer container (excluding comments)
  for (const root of roots) {
    const buttons = qsa<HTMLElement>(
      'button[aria-label], [role="button"][aria-label], button[title], [role="button"][title]',
      root
    );
    for (const btn of buttons) {
      if (inComments(btn) || !isVisible(btn)) continue;
      const raw = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim();
      const norm = normalizeText(raw);
      if (/comment|binh luan|share|chia se|repost|dang lai|bookmark|yeu thich/i.test(norm)) continue;
      if (/\b(unlike|like)\b/i.test(raw) || /\b(bo thich|da thich|thich)\b/.test(norm)) {
        return btn;
      }
    }
  }

  return null;
}

/**
 * Reads explicit fill/color values on an SVG/icon node.
 * Deliberately ignores `stroke` so white icon outlines never masquerade as unliked fills.
 */
function readNodeFills(node: Element, allowComputed = true): string[] {
  const values: string[] = [];
  const fillAttr = node.getAttribute('fill');
  if (fillAttr && fillAttr !== 'none' && fillAttr !== 'transparent') {
    values.push(fillAttr);
  }

  const inlineStyle = (node as HTMLElement).style;
  if (inlineStyle?.fill && inlineStyle.fill !== 'none') values.push(inlineStyle.fill);
  if (inlineStyle?.color && fillAttr === 'currentColor') values.push(inlineStyle.color);

  if (allowComputed) {
    try {
      const win = node.ownerDocument?.defaultView ?? window;
      const cs = win.getComputedStyle(node);
      if (cs?.fill && cs.fill !== 'none') values.push(cs.fill);
      if (cs?.color && fillAttr === 'currentColor') values.push(cs.color);
    } catch {
      /* ignore */
    }
  }
  return values;
}

function hasExplicitLikeHook(el: Element): boolean {
  const selfE2e = el.getAttribute('data-e2e') || '';
  if (LIKE_E2E_RE.test(selfE2e)) return true;
  if (el.querySelector('[data-e2e="browse-like-icon"], [data-e2e="like-icon"]')) return true;
  for (const child of qsa('[data-e2e]', el)) {
    const v = child.getAttribute('data-e2e') || '';
    if (LIKE_E2E_RE.test(v) && !/count|comment/i.test(v)) return true;
  }
  return false;
}

export interface LikeInspection {
  state: boolean | null;
  signal: string;
}

/**
 * Inspects the Like button and returns both the tri-state (`true | false | null`)
 * and the exact DOM signal that produced it (for audit logging & skipReason).
 */
export function inspectLikeButton(el: Element | null | undefined): LikeInspection {
  if (!el) return { state: null, signal: 'missing_element' };

  const targets: Element[] = [el];
  const ancestorBtn = el.closest('button, [role="button"]');
  if (ancestorBtn && ancestorBtn !== el && !inComments(ancestorBtn)) {
    targets.push(ancestorBtn);
  }
  const innerBtn = el.querySelector('button, [role="button"]');
  if (innerBtn && !targets.includes(innerBtn) && !inComments(innerBtn)) {
    targets.push(innerBtn);
  }
  const innerPressed = el.querySelector('[aria-pressed]');
  if (innerPressed && !targets.includes(innerPressed) && !inComments(innerPressed)) {
    targets.push(innerPressed);
  }

  // 1. Primary signal: `aria-pressed` ("true" = liked, "false" = unliked)
  for (const t of targets) {
    const pressed = t.getAttribute('aria-pressed');
    if (pressed === 'true') return { state: true, signal: 'aria-pressed=true' };
    if (pressed === 'false') return { state: false, signal: 'aria-pressed=false' };
  }

  // 2. Accessible `aria-label` / `title` in strict adversarial order:
  //    Check leading "Like ..." (`false`) BEFORE "liked" so `"Like video, liked by 1.2M"` -> `false`.
  for (const t of targets) {
    const raw = (t.getAttribute('aria-label') || t.getAttribute('title') || '').trim();
    if (!raw) continue;
    const norm = normalizeText(raw);

    if (/\bunlike\b/i.test(raw) || /\bbo thich\b/.test(norm)) {
      return { state: true, signal: `aria-label="${raw}"` };
    }
    if (/^like\b/i.test(raw) || /^thich\b/.test(norm)) {
      return { state: false, signal: `aria-label="${raw}"` };
    }
    if (
      (/\bliked\b/i.test(raw) && !/\bliked\s+by\b/i.test(raw)) ||
      (/\bda thich\b/.test(norm) && !/\bda thich boi\b/.test(norm))
    ) {
      return { state: true, signal: `aria-label="${raw}"` };
    }
  }

  // 3. SVG `<use>` sprite reference (`#like-unfill` vs `#like-fill`)
  for (const u of qsa('use', el)) {
    const href = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').toLowerCase();
    if (!href) continue;
    if (href.includes('unfill') || href.includes('outline')) {
      return { state: false, signal: `svg-use="${href}"` };
    }
    if (href.includes('fill') || href.includes('liked')) {
      return { state: true, signal: `svg-use="${href}"` };
    }
  }

  // 4. SVG / icon fill & color strictly anchored to TikTok brand red (`#fe2c55` / `rgb(254,44,85)`)
  const graphicNodes: Element[] = [
    el,
    ...qsa('[data-e2e*="like" i], svg, path, g, circle', el),
  ];
  for (const node of graphicNodes) {
    if (inComments(node)) continue;
    for (const val of readNodeFills(node, true)) {
      if (TIKTOK_RED_RE.test(val)) {
        return { state: true, signal: `svg-red-fill="${val}"` };
      }
    }
  }

  // 5. Conclude `false` from SVG fill ONLY when on a known like-icon hook AND an SVG shape
  //    has an explicit white/near-white fill (never default black or inherited body text color).
  if (hasExplicitLikeHook(el)) {
    const shapeNodes = qsa('path, svg, use, circle', el);
    for (const shape of shapeNodes) {
      if (inComments(shape)) continue;
      for (const val of readNodeFills(shape, true)) {
        if (NEUTRAL_HEART_FILL_RE.test(val)) {
          return { state: false, signal: `svg-neutral-fill="${val}"` };
        }
      }
    }
  }

  return { state: null, signal: 'indeterminate_dom' };
}

/**
 * Tri-state Like inspector:
 * - `true`  -> video is confirmed LIKED (safe to click once to unlike).
 * - `false` -> video shows UNLIKED signal.
 * - `null`  -> DOM state is indeterminate (never click!).
 */
export function isLiked(el: Element | null | undefined): boolean | null {
  return inspectLikeButton(el).state;
}

/** Boolean helper preserved for callers expecting `boolean`. */
export function isLikedState(el: HTMLElement): boolean {
  return isLiked(el) === true;
}

/**
 * Re-queries the live Like button from active containers before reading state.
 * Essential because React frequently replaces the `<button>` or `<svg>` DOM node on click,
 * leaving any cached `likeBtn` reference detached and stale.
 */
export function readLikeStateAgain(
  previousBtn?: HTMLElement | null,
  explicitRoot?: ParentNode | null
): boolean | null {
  const fresh = findLikeButton(explicitRoot);
  if (fresh) return isLiked(fresh);
  if (previousBtn && previousBtn.isConnected) return isLiked(previousBtn);
  return null;
}

export function extractVideoIdFromUrl(urlOrPath: string): string | null {
  const m = urlOrPath.match(/\/(?:video|photo)\/(\d+)/);
  return m ? m[1] : null;
}

export interface ViewerGuardResult {
  ok: boolean;
  code?: string;
  message?: string;
  haltRun?: boolean;
}

/**
 * Verifies we are inside a valid video detail / browse modal for the target video,
 * NOT on the For You feed or a deselected Liked tab.
 */
export function verifyLikedViewerGuard(
  expectedVideoId?: string,
  doc: Document = document
): ViewerGuardResult {
  const kind = viewerKind(doc);
  if (kind === 'feed') {
    return {
      ok: false,
      code: 'WRONG_FEED_GUARD',
      message:
        'Phát hiện bảng tin Dành cho bạn (For You) thay vì danh sách Đã thích. Đã tạm dừng an toàn.',
      haltRun: true,
    };
  }

  const deselectedLikedTab = doc.querySelector('[data-e2e="liked-tab"][aria-selected="false"]');
  if (deselectedLikedTab && isVisible(deselectedLikedTab)) {
    return {
      ok: false,
      code: 'LIKED_TAB_DESELECTED',
      message:
        'Tab Đã thích (Likes) không còn được chọn trên trang cá nhân. Đã tạm dừng để tránh thao tác nhầm.',
      haltRun: true,
    };
  }

  if (expectedVideoId) {
    const urlVideoId = extractVideoIdFromUrl(doc.location?.pathname || '');
    if (urlVideoId && urlVideoId !== expectedVideoId) {
      return {
        ok: false,
        code: 'VIDEO_ID_MISMATCH',
        message: `Trình phát đang hiển thị video ${urlVideoId} thay vì ${expectedVideoId}. Đã dừng thao tác trên video này để tránh bỏ tim nhầm.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Generic MutationObserver + AbortSignal + optional media-event waiter.
 * Evaluates `predicate()` immediately, on any DOM mutation, on optional `<video>` readiness
 * events, and at `pollMs` intervals until `predicate()` returns a non-null truthy result
 * or `timeoutMs` expires.
 */
function waitForDomCondition<T>(
  predicate: () => T | null,
  options: {
    timeoutMs: number;
    pollMs?: number;
    observeRoot?: Node;
    observeAttributes?: boolean;
    watchMediaEvents?: boolean;
    abortSignal?: AbortSignal;
  }
): Promise<{ value: T | null; aborted: boolean }> {
  const {
    timeoutMs,
    pollMs = 120,
    observeRoot = document.body || document.documentElement,
    observeAttributes = true,
    watchMediaEvents = false,
    abortSignal,
  } = options;

  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve({ value: null, aborted: true });
      return;
    }

    const initial = predicate();
    if (initial !== null) {
      resolve({ value: initial, aborted: false });
      return;
    }

    if (timeoutMs <= 0) {
      resolve({ value: null, aborted: false });
      return;
    }

    let settled = false;
    let observer: MutationObserver | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const attachedVideos = new Set<HTMLVideoElement>();

    const onMediaEvent = () => check();

    const attachVideoListeners = () => {
      if (!watchMediaEvents) return;
      for (const v of qsa<HTMLVideoElement>('video', document)) {
        if (attachedVideos.has(v)) continue;
        attachedVideos.add(v);
        v.addEventListener('loadedmetadata', onMediaEvent, { once: true });
        v.addEventListener('loadeddata', onMediaEvent, { once: true });
        v.addEventListener('canplay', onMediaEvent, { once: true });
      }
    };

    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      abortSignal?.removeEventListener('abort', onAbort);
      for (const v of attachedVideos) {
        v.removeEventListener('loadedmetadata', onMediaEvent);
        v.removeEventListener('loadeddata', onMediaEvent);
        v.removeEventListener('canplay', onMediaEvent);
      }
      attachedVideos.clear();
    };

    const onAbort = () => {
      cleanup();
      resolve({ value: null, aborted: true });
    };

    const check = () => {
      if (settled) return;
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      attachVideoListeners();
      const val = predicate();
      if (val !== null) {
        cleanup();
        resolve({ value: val, aborted: false });
      }
    };

    abortSignal?.addEventListener('abort', onAbort, { once: true });
    attachVideoListeners();

    try {
      if (observeRoot) {
        observer = new MutationObserver(() => check());
        observer.observe(observeRoot, {
          childList: true,
          subtree: true,
          attributes: observeAttributes,
          ...(observeAttributes
            ? {
                attributeFilter: [
                  'aria-pressed',
                  'aria-label',
                  'title',
                  'data-e2e',
                  'fill',
                  'class',
                  'style',
                  'src',
                  'href',
                  'data-loading',
                ],
              }
            : {}),
        });
      }
    } catch {
      /* ignore */
    }

    pollTimer = setInterval(check, pollMs);
    deadlineTimer = setTimeout(() => {
      const finalVal = predicate();
      cleanup();
      resolve({ value: finalVal, aborted: Boolean(abortSignal?.aborted) });
    }, timeoutMs);
  });
}

function isVideoElementStillLoading(containers: HTMLElement[]): boolean {
  for (const c of containers) {
    const videos = qsa<HTMLVideoElement>('video', c);
    for (const v of videos) {
      if (v.getAttribute('data-loading') === 'true') return true;
      const hasExplicitStream = Boolean(v.getAttribute('src') || v.querySelector('source'));
      // Note: blob:mock or empty <video></video> in unit tests has readyState === 0; only treat
      // real network URLs with readyState === 0 (or explicit data-loading="true") as still buffering.
      const srcVal = v.getAttribute('src') || '';
      if (hasExplicitStream && /^https?:/i.test(srcVal) && v.readyState === 0) {
        return true;
      }
    }
  }
  return false;
}

export interface RemoveLikeTimings {
  videoReadyWaitMs?: number;
  buttonWaitMs?: number;
  buttonMaxRetries?: number;
  hydrationWaitMs?: number;
  unlikedConfirmWaitMs?: number;
  preClickDelayMs?: number;
  postClickDelayMs?: number;
  verifyTimeoutMs?: number;
  verifyPollMs?: number;
  settleConfirmMs?: number;
  initialTrace?: LikeFlowStage[];
  onStageChange?: (stage: LikeFlowStage) => void;
}

export async function removeLike(
  videoId: string,
  _targetUrl: string,
  timings: RemoveLikeTimings = {}
): Promise<ActionResult> {
  const {
    videoReadyWaitMs = 4500,
    buttonWaitMs = 8000,
    buttonMaxRetries = 5,
    hydrationWaitMs = 4000,
    unlikedConfirmWaitMs = timings.hydrationWaitMs !== undefined
      ? Math.min(1600, Math.max(60, timings.hydrationWaitMs))
      : 1600,
    preClickDelayMs = 240,
    postClickDelayMs = 380,
    verifyTimeoutMs = 5500,
    verifyPollMs = 180,
    settleConfirmMs = 450,
    initialTrace,
    onStageChange,
  } = timings;

  const abortSignal = getActionAbortSignal();
  const trace: LikeFlowStage[] = [];

  const enterStage = (stage: LikeFlowStage) => {
    if (trace[trace.length - 1] !== stage) {
      trace.push(stage);
      onStageChange?.(stage);
    }
  };

  if (initialTrace && initialTrace.length > 0) {
    for (const st of initialTrace) enterStage(st);
  } else {
    enterStage('OPENING');
  }

  const finish = (
    status: ActionResult['status'],
    terminalStage: 'SUCCESS' | 'FAILED' | 'UNVERIFIED' | 'SKIPPED',
    code: string,
    message: string,
    extra?: { haltRun?: boolean; skipReason?: string }
  ): ActionResult => {
    enterStage(terminalStage);
    if (status === 'skipped') {
      const reason = extra?.skipReason || code;
      console.info(
        `[TikTokCleanerPro][LikeFlow][SKIPPED] videoId=${videoId} reason=${reason} trace=${trace.join(' -> ')} msg=${message}`
      );
    }
    return {
      status,
      code,
      message,
      stage: terminalStage,
      trace: [...trace],
      ...(extra?.haltRun ? { haltRun: true } : {}),
      ...(extra?.skipReason ? { skipReason: extra.skipReason } : {}),
    };
  };

  // Deduplication guard: never allow two concurrent unlike operations on the same videoId
  if (inFlightLikeVideos.has(videoId)) {
    return finish(
      'unverified',
      'UNVERIFIED',
      'DUPLICATE_IN_FLIGHT',
      `Video ${videoId} đang được xử lý ở tác vụ khác — bỏ qua lượt trùng để tránh nhấn tim lại.`
    );
  }

  inFlightLikeVideos.add(videoId);
  let clickedOnce = false;

  try {
    if (isActionAborted()) {
      return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
    }

    const checkSafetyHalt = (): ActionResult | null => {
      if (detectOffline()) {
        return finish('failed', 'FAILED', 'OFFLINE', 'Không có kết nối mạng', { haltRun: true });
      }
      if (detectHttp403(document)) {
        return finish(
          'failed',
          'FAILED',
          'HTTP_403',
          'TikTok từ chối truy cập (HTTP 403). Đã tạm dừng để bảo vệ tài khoản.',
          { haltRun: true }
        );
      }
      if (detectCaptcha()) {
        return finish(
          'failed',
          'FAILED',
          'CAPTCHA',
          'Phát hiện CAPTCHA trên TikTok. Vui lòng hoàn tất xác minh.',
          { haltRun: true }
        );
      }
      if (detectRateLimit()) {
        return finish(
          'failed',
          'FAILED',
          'RATE_LIMIT',
          'TikTok giới hạn tốc độ thao tác. Đã tạm dừng an toàn.',
          { haltRun: true }
        );
      }
      return null;
    };

    const initialHalt = checkSafetyHalt();
    if (initialHalt) return initialHalt;

    if (detectUnavailable()) {
      return finish(
        'unavailable',
        'FAILED',
        'VIDEO_UNAVAILABLE',
        'Video không khả dụng, riêng tư hoặc đã bị xóa'
      );
    }

    // =========================================================================
    // STAGE 1 -> 2: WAITING_FOR_VIDEO
    // Wait via MutationObserver + media events for active viewer container,
    // matching video URL (if SPA route is transitioning), and video readiness.
    // =========================================================================
    enterStage('WAITING_FOR_VIDEO');

    const immediateGuard = verifyLikedViewerGuard(videoId, document);
    if (!immediateGuard.ok && immediateGuard.haltRun) {
      return finish(
        'failed',
        'FAILED',
        immediateGuard.code || 'VIEWER_GUARD_FAILED',
        immediateGuard.message || 'Trình phát video không hợp lệ',
        { haltRun: true }
      );
    }

    const videoWaitBudget = Math.min(videoReadyWaitMs, Math.max(120, buttonWaitMs));
    const viewerReady = await waitForDomCondition<HTMLElement[]>(
      () => {
        if (detectUnavailable() || detectHttp403(document) || detectCaptcha() || detectRateLimit()) {
          return [];
        }
        const guard = verifyLikedViewerGuard(videoId, document);
        if (!guard.ok) {
          // Wait if URL is still transitioning from previous modal; abort immediately on For You feed
          if (guard.haltRun) return [];
          return null;
        }
        const containers = activeContainers(document);
        if (containers.length === 0) return null;

        // If the Like button is already confirmed LIKED (`true`), viewer is hydrated enough to proceed
        const existingBtn = findLikeButton();
        if (existingBtn && isLiked(existingBtn) === true) {
          return containers;
        }

        // Wait if `<video>` stream metadata is still actively loading
        if (isVideoElementStillLoading(containers)) {
          return null;
        }
        return containers;
      },
      {
        timeoutMs: videoWaitBudget,
        pollMs: 100,
        watchMediaEvents: true,
        abortSignal,
      }
    );

    if (viewerReady.aborted || isActionAborted()) {
      return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
    }

    const postVideoHalt = checkSafetyHalt();
    if (postVideoHalt) return postVideoHalt;

    if (detectUnavailable()) {
      return finish(
        'unavailable',
        'FAILED',
        'VIDEO_UNAVAILABLE',
        'Video không khả dụng, riêng tư hoặc đã bị xóa'
      );
    }

    const preGuard = verifyLikedViewerGuard(videoId, document);
    if (!preGuard.ok) {
      return finish(
        preGuard.code === 'VIDEO_ID_MISMATCH' ? 'failed' : 'unverified',
        preGuard.code === 'VIDEO_ID_MISMATCH' ? 'FAILED' : 'UNVERIFIED',
        preGuard.code || 'VIEWER_GUARD_FAILED',
        preGuard.message || 'Trình phát video không hợp lệ',
        { haltRun: preGuard.haltRun }
      );
    }

    // =========================================================================
    // STAGE 3: WAITING_FOR_LIKE_BUTTON
    // Bounded retries + MutationObserver — NEVER marks SKIPPED if missing!
    // =========================================================================
    enterStage('WAITING_FOR_LIKE_BUTTON');

    let likeBtn = findLikeButton();
    const retries = Math.max(1, buttonMaxRetries);
    const sliceMs = Math.max(40, Math.floor(buttonWaitMs / retries));

    for (let attempt = 0; !likeBtn && attempt < retries; attempt++) {
      const btnWait = await waitForDomCondition<HTMLElement>(
        () => {
          if (detectUnavailable() || detectHttp403(document) || detectCaptcha() || detectRateLimit()) {
            return document.body; // Break wait early to handle safety/unavailable state
          }
          return findLikeButton();
        },
        {
          timeoutMs: sliceMs,
          pollMs: Math.min(120, Math.max(25, Math.floor(sliceMs / 3))),
          observeAttributes: true,
          abortSignal,
        }
      );

      if (btnWait.aborted || isActionAborted()) {
        return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
      }

      const safety = checkSafetyHalt();
      if (safety) return safety;

      if (detectUnavailable()) {
        return finish(
          'unavailable',
          'FAILED',
          'VIDEO_UNAVAILABLE',
          'Video không khả dụng, riêng tư hoặc đã bị xóa'
        );
      }

      likeBtn = findLikeButton();
    }

    if (!likeBtn) {
      // Requirement 1, 7 & 8: NEVER mark SKIPPED when Like button was not found!
      return finish(
        'unverified',
        'UNVERIFIED',
        'LIKE_BUTTON_NOT_FOUND',
        'Không tìm thấy nút Tim sau khi chờ DOM tải xong — đánh dấu UNVERIFIED (không tự SKIPPED).'
      );
    }

    // =========================================================================
    // STAGE 4: CHECKING_LIKE
    // Inspect real liked state via MutationObserver + multi-sample confirmation
    // so unhydrated default `false` icons NEVER trigger premature SKIPPED!
    // =========================================================================
    enterStage('CHECKING_LIKE');

    let inspection = inspectLikeButton(likeBtn);

    // 4a. If state is `null` (indeterminate / attributes not yet hydrated), observe up to `hydrationWaitMs`
    if (inspection.state === null) {
      const hydrated = await waitForDomCondition<LikeInspection>(
        () => {
          const fresh = findLikeButton() ?? likeBtn;
          const cur = inspectLikeButton(fresh);
          return cur.state !== null ? cur : null;
        },
        {
          timeoutMs: hydrationWaitMs,
          pollMs: Math.min(120, Math.max(25, Math.floor(hydrationWaitMs / 4))),
          observeAttributes: true,
          watchMediaEvents: true,
          abortSignal,
        }
      );

      if (hydrated.aborted || isActionAborted()) {
        return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
      }
      likeBtn = findLikeButton() ?? likeBtn;
      inspection = hydrated.value ?? inspectLikeButton(likeBtn);
    }

    // 4b. Anti-Premature-SKIPPED Guard:
    // When `inspection.state === false` initially, TikTok's modal may still be hydrating the
    // user's `digged: true` state! Observe DOM & media events across `unlikedConfirmWaitMs`
    // and immediately catch any `false -> true` transition.
    if (inspection.state === false) {
      const containers = activeContainers(document);
      const effectiveConfirmMs = isVideoElementStillLoading(containers)
        ? Math.max(unlikedConfirmWaitMs, hydrationWaitMs)
        : unlikedConfirmWaitMs;

      let consecutiveFalseReads = 1;
      let lastFalseSignal = inspection.signal;
      const confirmStart = Date.now();
      const sampleInterval = Math.max(20, Math.floor(effectiveConfirmMs / 3));

      while (Date.now() - confirmStart < effectiveConfirmMs) {
        const remaining = effectiveConfirmMs - (Date.now() - confirmStart);
        const stepWait = Math.min(sampleInterval, Math.max(15, remaining));

        // Wake immediately if MutationObserver detects the button flipping to `true` or `null`!
        const flipped = await waitForDomCondition<LikeInspection>(
          () => {
            const fresh = findLikeButton();
            if (!fresh) return { state: null, signal: 'button_detached_during_check' };
            const cur = inspectLikeButton(fresh);
            if (cur.state === true || cur.state === null) return cur;
            return null;
          },
          {
            timeoutMs: stepWait,
            pollMs: Math.max(20, Math.floor(stepWait / 2)),
            observeAttributes: true,
            watchMediaEvents: true,
            abortSignal,
          }
        );

        if (flipped.aborted || isActionAborted()) {
          return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
        }

        const safety = checkSafetyHalt();
        if (safety) return safety;

        if (detectUnavailable()) {
          return finish(
            'unavailable',
            'FAILED',
            'VIDEO_UNAVAILABLE',
            'Video không khả dụng, riêng tư hoặc đã bị xóa'
          );
        }

        if (flipped.value?.state === true) {
          // Caught delayed hydration (`false -> true`)! Proceed to UNLIKING instead of skipping!
          likeBtn = findLikeButton() ?? likeBtn;
          inspection = flipped.value;
          break;
        }

        if (flipped.value?.state === null) {
          // Button entered re-render / indeterminate state; wait remaining hydration budget
          const settledAfterNull = await waitForDomCondition<LikeInspection>(
            () => {
              const fresh = findLikeButton();
              if (!fresh) return null;
              const cur = inspectLikeButton(fresh);
              return cur.state !== null ? cur : null;
            },
            {
              timeoutMs: Math.max(80, hydrationWaitMs - (Date.now() - confirmStart)),
              pollMs: 80,
              observeAttributes: true,
              abortSignal,
            }
          );
          if (settledAfterNull.aborted || isActionAborted()) {
            return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
          }
          likeBtn = findLikeButton() ?? likeBtn;
          inspection = settledAfterNull.value ?? inspectLikeButton(likeBtn);
          if (inspection.state !== false) break;
        }

        const freshBtn = findLikeButton();
        if (!freshBtn) {
          inspection = { state: null, signal: 'button_lost_during_check' };
          break;
        }
        likeBtn = freshBtn;
        const sample = inspectLikeButton(freshBtn);
        inspection = sample;
        if (sample.state === true || sample.state === null) {
          break;
        }
        consecutiveFalseReads += 1;
        lastFalseSignal = sample.signal;
      }

      if (inspection.state === false) {
        // Final guard check before allowing SKIPPED: ensure viewer is still on exact videoId
        const skipGuard = verifyLikedViewerGuard(videoId, document);
        if (!skipGuard.ok) {
          return finish(
            'unverified',
            'UNVERIFIED',
            skipGuard.code || 'VIEWER_GUARD_FAILED',
            skipGuard.message || 'Không thể xác minh đúng video trước khi đánh dấu SKIPPED',
            { haltRun: skipGuard.haltRun }
          );
        }

        const skipReason = `CONFIRMED_ALREADY_UNLIKED (${lastFalseSignal}, samples=${consecutiveFalseReads})`;
        return finish(
          'skipped',
          'SKIPPED',
          'ALREADY_UNLIKED',
          `Đã bỏ qua: Xác minh video đã ở trạng thái chưa thích từ trước (${lastFalseSignal}, kiểm tra ${consecutiveFalseReads} lần).`,
          { skipReason }
        );
      }
    }

    // Requirement 8: Indeterminate state MUST be marked UNVERIFIED, NEVER SKIPPED and NEVER clicked!
    if (inspection.state === null) {
      return finish(
        'unverified',
        'UNVERIFIED',
        'INDETERMINATE_LIKE_STATE',
        `Không xác định chắc chắn trạng thái nút Tim (${inspection.signal}) — đánh dấu UNVERIFIED, không click để tránh tim lại video.`
      );
    }

    // =========================================================================
    // STAGE 5: UNLIKING
    // Confirmed `inspection.state === true` -> Click ONCE with viewer guard!
    // =========================================================================
    enterStage('UNLIKING');

    const clickGuard = verifyLikedViewerGuard(videoId, document);
    if (!clickGuard.ok) {
      return finish(
        clickGuard.code === 'VIDEO_ID_MISMATCH' ? 'failed' : 'unverified',
        clickGuard.code === 'VIDEO_ID_MISMATCH' ? 'FAILED' : 'UNVERIFIED',
        clickGuard.code || 'VIEWER_GUARD_FAILED',
        clickGuard.message || 'Trình phát video đã thay đổi trước khi bỏ tim',
        { haltRun: clickGuard.haltRun }
      );
    }

    if (preClickDelayMs > 0) {
      if (!(await sleepUnlessActionAborted(preClickDelayMs))) {
        return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
      }
    }

    if (isActionAborted()) {
      return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
    }

    const liveBtn = findLikeButton() ?? likeBtn;
    const preClickInspection = inspectLikeButton(liveBtn);

    if (preClickInspection.state === null) {
      return finish(
        'unverified',
        'UNVERIFIED',
        'INDETERMINATE_BEFORE_CLICK',
        'Trạng thái nút Tim trở nên không xác định ngay trước khi nhấn — đã hủy click để tránh tim lại.'
      );
    }

    if (preClickInspection.state === false) {
      const skipReason = `CONFIRMED_UNLIKED_PRE_CLICK (${preClickInspection.signal})`;
      return finish(
        'skipped',
        'SKIPPED',
        'ALREADY_UNLIKED',
        `Đã bỏ qua: Nút Tim đã ở trạng thái bỏ thích trước khi click (${preClickInspection.signal}).`,
        { skipReason }
      );
    }

    if (clickedOnce) {
      return finish(
        'unverified',
        'UNVERIFIED',
        'SINGLE_CLICK_GUARD',
        'Đã chặn thao tác click lặp trên cùng một video.'
      );
    }
    clickedOnce = true;

    try {
      liveBtn.scrollIntoView?.({ block: 'center', inline: 'center' });
    } catch {
      /* ignore */
    }
    liveBtn.click();

    // =========================================================================
    // STAGE 6: VERIFYING
    // Wait via MutationObserver for TikTok to transition `true -> false` and
    // verify it stays `false` across `settleConfirmMs` (catching rollbacks).
    // =========================================================================
    enterStage('VERIFYING');

    if (postClickDelayMs > 0) {
      if (!(await sleepUnlessActionAborted(postClickDelayMs))) {
        return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
      }
    }

    const verifyDeadline = Date.now() + verifyTimeoutMs;
    let confirmedUnliked = false;

    while (Date.now() < verifyDeadline) {
      if (isActionAborted()) {
        return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
      }

      const safety = checkSafetyHalt();
      if (safety) return safety;

      const remaining = verifyDeadline - Date.now();
      if (remaining <= 0) break;

      const waitUnliked = await waitForDomCondition<true>(
        () => {
          if (detectHttp403(document) || detectCaptcha() || detectRateLimit()) {
            return true;
          }
          return readLikeStateAgain(liveBtn) === false ? true : null;
        },
        {
          timeoutMs: remaining,
          pollMs: verifyPollMs,
          observeAttributes: true,
          abortSignal,
        }
      );

      if (waitUnliked.aborted || isActionAborted()) {
        return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
      }

      const midSafety = checkSafetyHalt();
      if (midSafety) return midSafety;

      if (readLikeStateAgain(liveBtn) === false) {
        if (settleConfirmMs > 0) {
          if (!(await sleepUnlessActionAborted(settleConfirmMs))) {
            return finish('failed', 'FAILED', 'USER_ABORTED', 'Đã dừng theo yêu cầu người dùng.');
          }
          const postSettleSafety = checkSafetyHalt();
          if (postSettleSafety) return postSettleSafety;

          if (readLikeStateAgain(liveBtn) === false) {
            confirmedUnliked = true;
            break;
          }
          // Optimistic UI rolled back to `true` or `null`; keep observing until `verifyTimeoutMs`
        } else {
          confirmedUnliked = true;
          break;
        }
      }
    }

    if (confirmedUnliked) {
      return finish('success', 'SUCCESS', 'SUCCESS', 'Đã bỏ tim và xác minh thành công');
    }

    const finalState = readLikeStateAgain(liveBtn);
    if (finalState === null) {
      return finish(
        'unverified',
        'UNVERIFIED',
        'VERIFY_INDETERMINATE',
        'Đã nhấn bỏ tim nhưng DOM chuyển sang trạng thái không xác định — đánh dấu UNVERIFIED (không tự click lại).'
      );
    }

    return finish(
      'failed',
      'FAILED',
      'VERIFY_FAILED',
      'Đã nhấn bỏ tim 1 lần nhưng TikTok chưa cập nhật sang trạng thái chưa thích (không tự click lại để tránh tim lại).'
    );
  } finally {
    inFlightLikeVideos.delete(videoId);
  }
}
