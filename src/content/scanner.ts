import type { VideoKind } from '../shared/types';
import type { ScanResponse } from '../shared/messages';
import { extractAll, findGrid, findVideoAnchors } from '../services/video-scanner';
import {
  clickableAncestor,
  detectCaptcha,
  detectHttp403,
  detectOffline,
  detectRateLimit,
  findByText,
  firstVisible,
  humanClick,
  isOwnProfile,
  isVisible,
  qsa,
} from './dom-observer';
import { fetchPageSession, scanKindViaApi } from './tiktok-api';
import {
  abortScan,
  isScanAborted,
  resetScanAbort,
  sleepUnlessScanAborted,
  sleepWithAbort,
} from './abort-signal';

export function stopScanning() {
  abortScan();
}

const TAB_TEXT_PATTERNS: Record<VideoKind, { contains: string[]; exclude: string[] }> = {
  repost: {
    contains: ['repost', 'dang lai', 'đăng lại', 'da dang lai', 'đã đăng lại', 'bài đăng lại', 'bai dang lai'],
    exclude: [],
  },
  like: {
    contains: ['da thich', 'đã thích', 'liked', 'video đã thích'],
    exclude: ['yeu thich', 'yêu thích', 'favorite', 'favorites'],
  },
};

export function findProfileTabButton(kind: VideoKind, doc: Document = document): HTMLElement | null {
  // 1. Check data-e2e and role selectors
  const selectors = kind === 'repost'
    ? [
        '[data-e2e="user-repost-tab"]',
        '[data-e2e="repost-tab"]',
        '[data-e2e*="repost-tab"]',
        '[data-e2e*="repost"]',
        '[role="tab"][aria-controls*="repost"]',
        '[role="tab"][id*="repost"]',
      ]
    : [
        '[data-e2e="user-liked-tab"]',
        '[data-e2e="liked-tab"]',
        '[data-e2e*="liked-tab"]',
        '[data-e2e*="liked"]',
        '[role="tab"][aria-controls*="liked"]',
        '[role="tab"][id*="liked"]',
      ];

  for (const sel of selectors) {
    const el = firstVisible(sel, doc);
    if (el) {
      const text = (el.textContent || '').toLowerCase();
      if (kind === 'like' && (text.includes('yêu thích') || text.includes('yeu thich') || text.includes('favorite'))) {
        continue;
      }
      return clickableAncestor(el);
    }
  }

  // 2. Check tablist containers
  const tabContainers = qsa('[data-e2e="user-tab-list"], [role="tablist"], div[class*="TabContainer"], div[class*="tab-container"]', doc);
  const searchRoots: ParentNode[] = tabContainers.length > 0 ? tabContainers : [doc.body];

  for (const root of searchRoots) {
    const matches = findByText(TAB_TEXT_PATTERNS[kind], root);
    for (const m of matches) {
      const text = (m.textContent || '').toLowerCase();
      if (TAB_TEXT_PATTERNS[kind].exclude.some((ex) => text.includes(ex))) {
        continue;
      }
      const ancestor = clickableAncestor(m);
      if (isVisible(ancestor)) {
        return ancestor;
      }
    }
  }

  // 3. Fallback: all matching text on page
  const allMatches = findByText(TAB_TEXT_PATTERNS[kind], doc.body);
  for (const m of allMatches) {
    const text = (m.textContent || '').toLowerCase();
    if (TAB_TEXT_PATTERNS[kind].exclude.some((ex) => text.includes(ex))) {
      continue;
    }
    const ancestor = clickableAncestor(m);
    if (isVisible(ancestor)) {
      return ancestor;
    }
  }

  return null;
}

export function isTabActive(btn: HTMLElement): boolean {
  if (btn.getAttribute('aria-selected') === 'true') return true;
  if (btn.getAttribute('data-active') === 'true') return true;
  const cls = (btn.className || '').toLowerCase();
  if (cls.includes('active') || cls.includes('selected') || cls.includes('underline')) return true;
  const parent = btn.parentElement;
  if (parent) {
    if (parent.getAttribute('aria-selected') === 'true') return true;
    const pCls = (parent.className || '').toLowerCase();
    if (pCls.includes('active') || pCls.includes('selected')) return true;
  }
  return false;
}

export interface GridWaitResult {
  grid: Element | null;
  empty: boolean;
}

export function waitForGridOrEmpty(
  kind: VideoKind,
  timeoutMs = 8000,
  abortSignal?: AbortSignal
): Promise<GridWaitResult> {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve({ grid: null, empty: false });
      return;
    }

    const checkImmediate = (): GridWaitResult | null => {
      const g = findGrid(document, kind);
      if (g && isVisible(g)) {
        return { grid: g, empty: false };
      }
      const emptyIndicators = findByText(
        {
          contains: [
            'chua co video dang lai',
            'chưa có video đăng lại',
            'chua dang lai',
            'chưa đăng lại',
            'no reposted videos yet',
            'no reposts yet',
            'no liked videos yet',
            'chua co video da thich',
            'chưa có video đã thích',
            'no videos yet',
            'chua co video nao',
            'chưa có video nào',
          ],
        },
        document.body
      );
      if (emptyIndicators.some((el) => isVisible(el))) {
        return { grid: null, empty: true };
      }
      return null;
    };

    const immediate = checkImmediate();
    if (immediate) {
      resolve(immediate);
      return;
    }

    let settled = false;
    let observer: MutationObserver | null = null;
    let intervalTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        if (observer) observer.disconnect();
        if (intervalTimer) clearInterval(intervalTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        abortSignal?.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      resolve({ grid: null, empty: false });
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    const attempt = () => {
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      const res = checkImmediate();
      if (res) {
        cleanup();
        resolve(res);
      }
    };

    try {
      observer = new MutationObserver(() => {
        attempt();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }

    intervalTimer = setInterval(attempt, 200);

    timeoutTimer = setTimeout(() => {
      const finalRes = checkImmediate();
      cleanup();
      resolve(finalRes || { grid: null, empty: false });
    }, timeoutMs);
  });
}

export function waitForHydratedGridItems(
  kind: VideoKind,
  timeoutMs = 6000,
  abortSignal?: AbortSignal
): Promise<{ grid: Element | null; anchorCount: number; empty: boolean }> {
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      resolve({ grid: null, anchorCount: 0, empty: false });
      return;
    }

    const inspect = (): { grid: Element | null; anchorCount: number; empty: boolean } | null => {
      const g = findGrid(document, kind);
      if (g && isVisible(g)) {
        const anchors = findVideoAnchors(g);
        if (anchors.length > 0) {
          return { grid: g, anchorCount: anchors.length, empty: false };
        }
      }
      const emptyIndicators = findByText(
        {
          contains: [
            'chua co video dang lai',
            'chưa có video đăng lại',
            'chua dang lai',
            'chưa đăng lại',
            'no reposted videos yet',
            'no reposts yet',
            'no liked videos yet',
            'chua co video da thich',
            'chưa có video đã thích',
            'no videos yet',
            'chua co video nao',
            'chưa có video nào',
          ],
        },
        document.body
      );
      if (emptyIndicators.some((el) => isVisible(el))) {
        return { grid: g ?? null, anchorCount: 0, empty: true };
      }
      return null;
    };

    const immediate = inspect();
    if (immediate) {
      resolve(immediate);
      return;
    }

    let settled = false;
    let observer: MutationObserver | null = null;
    let intervalTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        observer?.disconnect();
        if (intervalTimer) clearInterval(intervalTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        abortSignal?.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      resolve({ grid: null, anchorCount: 0, empty: false });
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    const attempt = () => {
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      const res = inspect();
      if (res) {
        cleanup();
        resolve(res);
      }
    };

    try {
      observer = new MutationObserver(() => attempt());
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }

    intervalTimer = setInterval(attempt, 200);
    timeoutTimer = setTimeout(() => {
      const finalGrid = findGrid(document, kind);
      const count = finalGrid ? findVideoAnchors(finalGrid).length : 0;
      cleanup();
      resolve({ grid: finalGrid ?? null, anchorCount: count, empty: false });
    }, timeoutMs);
  });
}

export async function openProfileTab(
  kind: VideoKind,
  username: string,
  abortSignal?: AbortSignal
): Promise<{ ok: boolean; error?: string }> {
  if (abortSignal?.aborted) {
    return { ok: false, error: 'USER_ABORTED' };
  }

  const path = window.location.pathname.toLowerCase();
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const userPath = `/@${cleanUsername}`;

  // If not yet on profile, report so background can navigate cleanly once
  if (!path.includes(userPath)) {
    return { ok: false, error: 'NAVIGATING_TO_PROFILE' };
  }

  // Find the tab button (retry up to 15 times with 300ms sleep for hydration)
  let tabBtn = findProfileTabButton(kind, document);
  for (let retry = 0; !tabBtn && retry < 15; retry++) {
    if (abortSignal) {
      const ok = await sleepWithAbort(300, abortSignal);
      if (!ok) return { ok: false, error: 'USER_ABORTED' };
    } else {
      await new Promise((r) => setTimeout(r, 300));
    }
    tabBtn = findProfileTabButton(kind, document);
  }

  if (abortSignal?.aborted) {
    return { ok: false, error: 'USER_ABORTED' };
  }

  if (tabBtn) {
    // Skip re-clicking only if this exact tab is already active AND its grid has hydrated items
    const existingGrid = findGrid(document, kind);
    if (
      isTabActive(tabBtn) &&
      existingGrid &&
      isVisible(existingGrid) &&
      findVideoAnchors(existingGrid).length > 0
    ) {
      return { ok: true };
    }

    if (!isTabActive(tabBtn) || !existingGrid) {
      humanClick(tabBtn);
      try {
        tabBtn.click();
      } catch {
        /* ignore */
      }
      const inner = tabBtn.querySelector('p, span, div');
      if (inner && inner !== tabBtn) {
        try {
          (inner as HTMLElement).click();
        } catch {
          /* ignore */
        }
      }
    }

    // Wait for tab grid AND hydrated video anchors (or explicit empty state) via MutationObserver
    const gridState = await waitForGridOrEmpty(kind, 8000, abortSignal);
    if (abortSignal?.aborted) {
      return { ok: false, error: 'USER_ABORTED' };
    }
    if (!gridState.empty) {
      await waitForHydratedGridItems(kind, 6000, abortSignal);
      if (abortSignal?.aborted) {
        return { ok: false, error: 'USER_ABORTED' };
      }
    }
  } else {
    // If not our own profile and there's a private notice
    if (!isOwnProfile(document)) {
      const privateTexts = findByText({
        contains: ['videos are private', 'video da thich cua nguoi dung nay la rieng tu'],
      });
      if (privateTexts.some((p) => isVisible(p))) {
        return {
          ok: false,
          error: `TAB_PRIVATE: Tab ${kind === 'repost' ? 'Đăng lại' : 'Đã thích'} của người dùng này đang ở chế độ riêng tư.`,
        };
      }
    }
    return {
      ok: false,
      error: `TAB_NOT_FOUND: Không tìm thấy tab ${kind === 'repost' ? 'Đăng lại (Reposts)' : 'Đã thích (Liked)'} trên trang cá nhân @${cleanUsername}.`,
    };
  }

  return { ok: true };
}

export type ScanEndReason =
  | 'COMPLETED'
  | 'EMPTY'
  | 'STALLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ACCESS_DENIED'
  | 'LIMIT_REACHED';

export class ScanEndDetector {
  private streak = 0;
  private readonly maxStreak: number;
  private lastCount = 0;

  constructor(maxStreak = 8) {
    this.maxStreak = maxStreak;
  }

  recordProgress(foundCount: number): boolean {
    if (foundCount > this.lastCount) {
      this.lastCount = foundCount;
      this.streak = 0;
      return true;
    }
    this.streak++;
    return false;
  }

  getStreak(): number {
    return this.streak;
  }

  isStalled(): boolean {
    return this.streak >= this.maxStreak;
  }

  hasReachedBottom(container: Element | Window): boolean {
    if (container === window) {
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
      const clientHeight = window.innerHeight;
      const currentScroll = window.scrollY || window.pageYOffset;
      return currentScroll + clientHeight >= scrollHeight - 350;
    } else {
      const el = container as HTMLElement;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 350;
    }
  }

  hasEndOfFeedIndicator(doc: Document = document): boolean {
    const endIndicators = findByText(
      {
        contains: [
          'khong con noi dung',
          'không còn nội dung',
          'da xem het',
          'đã xem hết',
          'no more videos',
          'you have reached the end',
          'no more content',
          'không có video nào khác',
          'khong co video nao khac',
        ],
      },
      doc.body
    );
    return endIndicators.some((el) => isVisible(el));
  }
}

export function detectScrollContainer(grid: Element): Element | Window {
  let el: Element | null = grid.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
      return el;
    }
    el = el.parentElement;
  }
  return window;
}

export function performScroll(container: Element | Window, deltaY: number) {
  if (container === window) {
    window.scrollBy({ top: deltaY, behavior: 'smooth' });
  } else {
    (container as HTMLElement).scrollBy({ top: deltaY, behavior: 'smooth' });
  }
}

export function getScrollPosition(container: Element | Window): number {
  if (container === window) {
    return window.scrollY || window.pageYOffset;
  }
  return (container as HTMLElement).scrollTop;
}

function notifyScanDone(
  kind: VideoKind,
  resp: ScanResponse,
  haltRun?: boolean
): ScanResponse {
  chrome.runtime
    .sendMessage({
      type: 'SCAN_DONE',
      kind,
      total: resp.total,
      code: resp.code,
      message: resp.message,
      haltRun,
    })
    .catch(() => {});
  return resp;
}

export async function runScan(
  kind: VideoKind,
  username: string,
  limit: number,
  knownIds: string[],
  providedSecUid?: string | null,
  skipApi = false
): Promise<ScanResponse> {
  const scanSignal = resetScanAbort();

  if (detectOffline()) {
    return notifyScanDone(kind, { ok: false, code: 'OFFLINE', message: 'Không có kết nối mạng.', total: 0 }, true);
  }
  if (detectHttp403(document)) {
    return notifyScanDone(
      kind,
      {
        ok: false,
        code: 'HTTP_403',
        message: 'TikTok từ chối truy cập (HTTP 403). Đã dừng an toàn để bảo vệ tài khoản.',
        total: 0,
      },
      true
    );
  }
  if (detectCaptcha()) {
    return notifyScanDone(
      kind,
      { ok: false, code: 'CAPTCHA', message: 'Phát hiện CAPTCHA trên TikTok. Vui lòng xác minh trước khi quét.', total: 0 },
      true
    );
  }

  // 1. Primary mechanism (from yiitxyz/tiktokRepostRemover):
  // Paginated first-party web session API scan using cursor + hasMore (no tab navigation or infinite scroll!)
  if (!skipApi) {
    let secUid = providedSecUid || null;
    if (!secUid) {
      const session = await fetchPageSession();
      if (isScanAborted()) {
        return notifyScanDone(kind, { ok: true, code: 'CANCELLED', message: 'Quá trình quét đã được dừng.', total: 0 });
      }
      if (session.http403) {
        return notifyScanDone(
          kind,
          {
            ok: false,
            code: 'HTTP_403',
            message: 'TikTok từ chối truy cập (HTTP 403). Đã dừng an toàn.',
            total: 0,
          },
          true
        );
      }
      secUid = session.secUid;
    }

    if (secUid) {
      const apiResult = await scanKindViaApi(kind, secUid, username, limit, knownIds, isScanAborted);
      if (isScanAborted() || apiResult.code === 'CANCELLED') {
        return notifyScanDone(kind, {
          ok: true,
          code: 'CANCELLED',
          message: apiResult.message || 'Quá trình quét đã được dừng.',
          total: apiResult.total,
        });
      }
      if (apiResult.haltRun) {
        return notifyScanDone(
          kind,
          {
            ok: false,
            code: apiResult.code,
            message: apiResult.message,
            total: apiResult.total,
          },
          true
        );
      }
      if (!apiResult.fallbackToDom) {
        return notifyScanDone(kind, {
          ok: apiResult.ok,
          code: apiResult.code,
          message: apiResult.message,
          total: apiResult.total,
        });
      }
    }
  }

  if (isScanAborted()) {
    return notifyScanDone(kind, { ok: true, code: 'CANCELLED', message: 'Quá trình quét đã được dừng.', total: 0 });
  }

  // 2. Secondary fallback: In-page Profile Tab DOM Scanner with strict ScanEndDetector
  const tabRes = await openProfileTab(kind, username, scanSignal);
  if (isScanAborted() || tabRes.error === 'USER_ABORTED') {
    return notifyScanDone(kind, { ok: true, code: 'CANCELLED', message: 'Quá trình quét đã được dừng.', total: 0 });
  }
  if (!tabRes.ok) {
    const errCode = tabRes.error?.split(':')[0] || 'TAB_ERROR';
    return notifyScanDone(kind, {
      ok: false,
      code: errCode,
      message: tabRes.error || '',
      total: 0,
    });
  }

  // Wait for initial grid container or empty state
  const waitResult = await waitForGridOrEmpty(kind, 8000, scanSignal);
  if (isScanAborted()) {
    return notifyScanDone(kind, { ok: true, code: 'CANCELLED', message: 'Quá trình quét đã được dừng.', total: 0 });
  }
  if (waitResult.empty) {
    return notifyScanDone(kind, { ok: true, code: 'EMPTY', message: 'Tab không có video nào', total: 0 });
  }

  let grid = waitResult.grid || findGrid(document, kind);
  if (!grid) {
    return notifyScanDone(kind, { ok: false, code: 'GRID_NOT_FOUND', message: `Không tìm thấy danh sách video ${kind}`, total: 0 });
  }

  const scrollContainer = detectScrollContainer(grid);
  // Ensure DOM scan always begins from the top of the profile tab (Newest -> Oldest)
  if (getScrollPosition(scrollContainer) > 100) {
    if (scrollContainer === window) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      (scrollContainer as HTMLElement).scrollTop = 0;
    }
    if (!(await sleepUnlessScanAborted(400))) {
      return notifyScanDone(kind, { ok: true, code: 'CANCELLED', message: 'Quá trình quét đã được dừng.', total: 0 });
    }
  }

  const endDetector = new ScanEndDetector(8);
  const seenIds = new Set<string>(knownIds);
  let totalFound = 0;
  let lastScrollPos = getScrollPosition(scrollContainer);
  let endReason: ScanEndReason = 'COMPLETED';

  while (!isScanAborted() && totalFound < limit) {
    if (detectCaptcha()) {
      endReason = 'FAILED';
      break;
    }
    if (detectRateLimit()) {
      endReason = 'FAILED';
      break;
    }

    // Extract ONLY from the specific grid container for this kind
    const currentGrid = findGrid(document, kind) || grid;
    if (!currentGrid) {
      endDetector.recordProgress(totalFound);
      if (endDetector.isStalled()) {
        endReason = 'STALLED';
        break;
      }
      if (!(await sleepUnlessScanAborted(600))) break;
      continue;
    }

    // Extract items (user's own posts and private locks are filtered out)
    const items = extractAll(currentGrid, kind, window.location.origin, username);
    const newItems = items.filter((it) => !seenIds.has(it.videoId));

    if (isScanAborted()) break;

    if (newItems.length > 0) {
      for (const it of newItems) {
        seenIds.add(it.videoId);
      }
      totalFound += newItems.length;
      endDetector.recordProgress(totalFound);

      // Send batch to background worker
      chrome.runtime.sendMessage({
        type: 'SCAN_BATCH',
        kind,
        items: newItems,
      }).catch(() => {});

      chrome.runtime.sendMessage({
        type: 'SCAN_PROGRESS',
        kind,
        found: totalFound,
        message: `Đang quét: đã tìm thấy ${totalFound} video...`,
      }).catch(() => {});
    } else {
      endDetector.recordProgress(totalFound);
    }

    if (totalFound >= limit) {
      endReason = 'LIMIT_REACHED';
      break;
    }

    // 1. Check explicit end-of-feed text indicator from TikTok
    if (endDetector.hasEndOfFeedIndicator(document) && endDetector.getStreak() >= 2) {
      endReason = 'COMPLETED';
      break;
    }

    // 2. Check if TikTok is currently loading more videos
    const isLoading = !!document.querySelector(
      '[data-e2e*="loading"], [class*="loading" i], [class*="spinner" i], svg circle[class*="loading" i]'
    );
    if (isLoading && endDetector.getStreak() < 10) {
      if (!(await sleepUnlessScanAborted(1400))) break;
      continue;
    }

    // 3. Check if reached bottom of scroll container
    if (endDetector.hasReachedBottom(scrollContainer) && endDetector.getStreak() >= 3) {
      endReason = 'COMPLETED';
      break;
    }

    // 4. Stalled: no new videos after multiple scroll attempts
    if (endDetector.isStalled()) {
      endReason = totalFound > 0 ? 'COMPLETED' : 'STALLED';
      break;
    }

    // Jiggle scroll to re-trigger IntersectionObserver if streak is mounting
    if (endDetector.getStreak() >= 3 && endDetector.getStreak() % 2 === 1) {
      performScroll(scrollContainer, -300);
      if (!(await sleepUnlessScanAborted(500))) break;
      performScroll(scrollContainer, 600);
      if (!(await sleepUnlessScanAborted(1000))) break;
      continue;
    }

    // Scroll down to load more
    lastScrollPos = getScrollPosition(scrollContainer);
    performScroll(scrollContainer, window.innerHeight * 1.5);

    // Humanized settle sleep (wakes up in 0ms on Stop Scan)
    if (!(await sleepUnlessScanAborted(1100 + Math.random() * 400))) break;

    // If scroll didn't move
    const currentScrollPos = getScrollPosition(scrollContainer);
    if (currentScrollPos === lastScrollPos && endDetector.getStreak() >= 2) {
      if (scrollContainer === window) {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      } else {
        (scrollContainer as HTMLElement).scrollTop = (scrollContainer as HTMLElement).scrollHeight;
      }
      if (!(await sleepUnlessScanAborted(900))) break;
    }
  }

  if (isScanAborted()) {
    endReason = 'CANCELLED';
  }

  const successMsg = `Quét thành công! Đã tìm thấy ${totalFound} video.`;
  const finalResponse: ScanResponse = {
    ok: endReason !== 'FAILED',
    code: endReason,
    message: isScanAborted() ? 'Quá trình quét đã được dừng.' : successMsg,
    total: totalFound,
  };

  chrome.runtime.sendMessage({
    type: 'SCAN_DONE',
    kind,
    total: totalFound,
    code: endReason,
    message: finalResponse.message,
  }).catch(() => {});

  return finalResponse;
}
