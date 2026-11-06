import type { BgToContent, PingResponse } from '../shared/messages';
import type { ActionResult, VideoKind } from '../shared/types';
import {
  clickableAncestor,
  detectAccount,
  detectCaptcha,
  detectHttp403,
  detectUnavailable,
  humanClick,
  isVisible,
  pressEscape,
} from './dom-observer';
import {
  detectScrollContainer,
  getScrollPosition,
  openProfileTab,
  performScroll,
  runScan,
  stopScanning,
} from './scanner';
import {
  BROWSE_SELECTORS,
  extractVideoIdFromUrl,
  removeLike,
  viewerKind,
} from './like-handler';
import { removeRepost } from './repost-handler';
import { SafetyStopError, verifyRepostsViaApi } from './tiktok-api';
import { sleep } from '../shared/utils';
import {
  abortAction,
  getActionAbortSignal,
  isActionAborted,
  resetActionAbort,
  sleepUnlessActionAborted,
} from './abort-signal';

const MODAL_SELECTORS = [
  ...BROWSE_SELECTORS,
  '[data-e2e="browse-close"]',
  '[data-e2e="close-button"]',
  '[data-e2e="browse-like-icon"]',
  '[data-e2e="browse-share-icon"]',
  '[data-e2e="browse-repost-icon"]',
  'div[class*="DetailContainer"]',
  'div[class*="BrowseMode"]',
];

function isModalOpen(): boolean {
  if (viewerKind(document) === 'browse') return true;
  for (const sel of MODAL_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) return true;
  }
  return false;
}

function currentViewerVideoSrc(): string | null {
  for (const sel of BROWSE_SELECTORS) {
    const v = document.querySelector<HTMLVideoElement>(`${sel} video`);
    if (v && (v.currentSrc || v.src)) return v.currentSrc || v.src;
  }
  return null;
}

function waitForModal(
  timeoutMs = 6000,
  expectedVideoId?: string,
  previousVideoSrc?: string | null
): Promise<boolean> {
  const abortSignal = getActionAbortSignal();

  return new Promise((resolve) => {
    if (abortSignal.aborted) {
      resolve(false);
      return;
    }

    const isReady = (): boolean => {
      if (!isModalOpen()) return false;
      const urlVid = extractVideoIdFromUrl(window.location.pathname);
      if (expectedVideoId && urlVid && urlVid !== expectedVideoId) {
        return false;
      }
      if (previousVideoSrc) {
        const curSrc = currentViewerVideoSrc();
        // Avoid mistaking a still-closing modal from the previous video before URL/media updates
        if (curSrc && curSrc === previousVideoSrc && (!urlVid || urlVid !== expectedVideoId)) {
          return false;
        }
      }
      return true;
    };

    if (isReady()) {
      resolve(true);
      return;
    }

    let settled = false;
    let observer: MutationObserver | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      abortSignal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    const check = () => {
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      if (isReady()) {
        cleanup();
        resolve(true);
      }
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });

    try {
      observer = new MutationObserver(() => check());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-e2e', 'class', 'style', 'src', 'aria-pressed'],
      });
    } catch {
      /* ignore */
    }

    pollTimer = setInterval(check, 120);
    timeoutTimer = setTimeout(() => {
      const ok = isReady();
      cleanup();
      resolve(ok);
    }, timeoutMs);
  });
}

async function closeModal(expectedProfileAccount?: string): Promise<void> {
  const onVideoRoute = () => Boolean(extractVideoIdFromUrl(window.location.pathname));
  if (!isModalOpen() && !onVideoRoute()) return;

  const closeSelectors = [
    '[data-e2e="browse-close"]',
    '[data-e2e="close-button"]',
    'button[aria-label*="close" i]',
    'button[aria-label*="đóng" i]',
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el && isVisible(el)) {
        humanClick(clickableAncestor(el));
        await sleep(280);
        if (!isModalOpen() && !onVideoRoute()) return;
      }
    }

    if (!isModalOpen() && !onVideoRoute()) return;

    pressEscape();
    await sleep(320);

    if (!isModalOpen() && !onVideoRoute()) return;
  }

  // SPA fallback: if TikTok pushed `/@creator/video/<id>` onto history (e.g. `#main-content-video_detail`)
  // and Escape/close left the URL on `/video/<id>`, pop back via SPA history so the profile grid stays mounted
  // without triggering a full-page reload on the next video.
  if (onVideoRoute() && window.history.length > 1) {
    try {
      window.history.back();
      const backDeadline = Date.now() + 2200;
      while (Date.now() < backDeadline) {
        await sleep(150);
        if (!onVideoRoute()) {
          if (
            !expectedProfileAccount ||
            window.location.pathname.toLowerCase().includes(`/@${expectedProfileAccount.toLowerCase()}`)
          ) {
            break;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}

function findVideoCard(videoId: string): HTMLElement | null {
  const anchor = document.querySelector(
    `a[href*="/video/${videoId}"], a[href*="/photo/${videoId}"]`
  );
  if (!anchor) return null;
  return anchor as HTMLElement;
}

function waitForNewGridAnchors(previousCount: number, timeoutMs = 1200): Promise<boolean> {
  const abortSignal = getActionAbortSignal();
  return new Promise((resolve) => {
    const countAnchors = () =>
      document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]').length;

    if (abortSignal.aborted || countAnchors() > previousCount) {
      resolve(!abortSignal.aborted && countAnchors() > previousCount);
      return;
    }

    let settled = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (timer) clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });

    try {
      observer = new MutationObserver(() => {
        if (countAnchors() > previousCount) {
          cleanup();
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }

    timer = setTimeout(() => {
      const grew = countAnchors() > previousCount;
      cleanup();
      resolve(grew);
    }, timeoutMs);
  });
}

async function scrollSearchDown(
  videoId: string,
  container: Element | Window,
  maxScrolls: number
): Promise<HTMLElement | null> {
  if (isActionAborted()) return null;
  let card = findVideoCard(videoId);
  if (card && isVisible(card)) return card;

  let lastPos = getScrollPosition(container);
  let stalledCount = 0;

  for (let i = 0; i < maxScrolls && !isActionAborted(); i++) {
    const prevAnchorCount = document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]').length;
    performScroll(container, Math.max(500, window.innerHeight * 1.25));
    if (!(await sleepUnlessActionAborted(550))) return null;

    card = findVideoCard(videoId);
    if (card && isVisible(card)) return card;

    const currentPos = getScrollPosition(container);
    if (Math.abs(currentPos - lastPos) < 10) {
      // Wait via MutationObserver in case TikTok is fetching the next page of grid items
      const grew = await waitForNewGridAnchors(prevAnchorCount, 1200);
      if (isActionAborted()) return null;
      card = findVideoCard(videoId);
      if (card && isVisible(card)) return card;

      if (grew) {
        stalledCount = 0;
      } else {
        stalledCount += 1;
        if (stalledCount >= 2) {
          if (container === window) {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          } else {
            (container as HTMLElement).scrollTop = (container as HTMLElement).scrollHeight;
          }
          if (!(await sleepUnlessActionAborted(850))) return null;
          card = findVideoCard(videoId);
          if (card && isVisible(card)) return card;
          if (stalledCount >= 3) break;
        }
      }
    } else {
      stalledCount = 0;
    }
    lastPos = currentPos;
  }

  return null;
}

async function locateAndScrollToCard(videoId: string, maxScrolls = 20): Promise<HTMLElement | null> {
  if (isActionAborted()) return null;
  const existing = findVideoCard(videoId);
  if (existing && isVisible(existing)) return existing;

  const currentGrid =
    document.querySelector('[data-e2e*="item-list"], [role="tabpanel"], main') || document.body;
  const container = detectScrollContainer(currentGrid);
  const startPos = getScrollPosition(container);

  const foundDown = await scrollSearchDown(videoId, container, maxScrolls);
  if (foundDown || isActionAborted()) return foundDown;

  // If we started partway down the page, reset to top once so earlier cards are never missed
  if (startPos > 350) {
    if (container === window) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      (container as HTMLElement).scrollTop = 0;
    }
    if (!(await sleepUnlessActionAborted(600))) return null;
    return scrollSearchDown(videoId, container, maxScrolls);
  }

  return null;
}

/**
 * Clicks a video card to open TikTok's in-page browse modal without allowing native
 * full-page `<a href>` navigation. Attaching `preventDefault` on `window` (bubble phase)
 * runs AFTER React 18's `#app` root event delegation, so React sees `defaultPrevented === false`
 * and opens `[data-e2e="browse-video-container"]` while native browser navigation is blocked.
 */
function clickWithoutFullPageNav(target: HTMLElement): void {
  const blockNativeNav = (e: MouseEvent) => {
    e.preventDefault();
  };
  window.addEventListener('click', blockNativeNav, { capture: false });
  try {
    humanClick(target);
  } finally {
    window.removeEventListener('click', blockNativeNav, { capture: false });
  }
}

async function openVideoModal(card: HTMLElement, expectedVideoId?: string): Promise<boolean> {
  if (isActionAborted()) return false;
  if (isModalOpen()) {
    const curVid = extractVideoIdFromUrl(window.location.pathname);
    if (expectedVideoId && curVid === expectedVideoId) {
      return true;
    }
  }

  const previousSrc = currentViewerVideoSrc();

  const anchor = (
    card.tagName.toLowerCase() === 'a' ? card : card.closest('a')
  ) as HTMLAnchorElement | null;

  const innerTarget = (
    card.querySelector(
      'canvas, video, img, [class*="PlayerContainer"], [class*="CardContainer"], [class*="DivWrapper"]'
    ) ||
    anchor ||
    card
  ) as HTMLElement;

  clickWithoutFullPageNav(innerTarget);
  let opened = await waitForModal(4500, expectedVideoId, previousSrc);

  if (!opened && !isActionAborted() && anchor && anchor !== innerTarget) {
    clickWithoutFullPageNav(anchor);
    opened = await waitForModal(4000, expectedVideoId, previousSrc);
  }

  return opened;
}

export async function performActionOnProfile(
  action: 'remove_repost' | 'remove_like',
  videoId: string,
  account: string,
  url?: string,
  options?: { domOnly?: boolean; maxScrolls?: number }
): Promise<ActionResult> {
  if (isActionAborted()) {
    return {
      status: 'failed',
      code: 'USER_ABORTED',
      stage: 'FAILED',
      trace: ['OPENING', 'FAILED'],
      message: 'Đã dừng theo yêu cầu người dùng.',
    };
  }

  const kind: VideoKind = action === 'remove_repost' ? 'repost' : 'like';
  const cleanAccount = account.replace(/^@/, '');

  // STAGE 1: OPENING — Ensure no leftover modal or `/video/<id>` SPA route from a previous video is open
  await closeModal(cleanAccount);
  if (isActionAborted()) {
    return {
      status: 'failed',
      code: 'USER_ABORTED',
      stage: 'FAILED',
      trace: ['OPENING', 'FAILED'],
      message: 'Đã dừng theo yêu cầu người dùng.',
    };
  }

  // 1. Ensure the correct profile tab is active & hydrated
  const tabRes = await openProfileTab(kind, cleanAccount, getActionAbortSignal());
  if (isActionAborted() || tabRes.error === 'USER_ABORTED') {
    return {
      status: 'failed',
      code: 'USER_ABORTED',
      stage: 'FAILED',
      trace: ['OPENING', 'FAILED'],
      message: 'Đã dừng theo yêu cầu người dùng.',
    };
  }
  if (!tabRes.ok) {
    return {
      status: 'failed',
      code: 'TAB_ERROR',
      stage: 'FAILED',
      trace: ['OPENING', 'FAILED'],
      message: tabRes.error || `Không thể mở tab ${kind} trên trang cá nhân`,
    };
  }

  // 2. Locate the video card in the profile tab (with bounded re-check if grid is still hydrating)
  const scrollBudget = options?.maxScrolls ?? 20;
  let card = await locateAndScrollToCard(videoId, scrollBudget);
  if (!card && !isActionAborted() && scrollBudget > 0) {
    // Bounded re-check via MutationObserver in case initial grid hydration finished slightly late
    await waitForNewGridAnchors(
      document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]').length,
      1500
    );
    if (!isActionAborted()) {
      card = findVideoCard(videoId);
    }
  }

  if (isActionAborted()) {
    return {
      status: 'failed',
      code: 'USER_ABORTED',
      stage: 'FAILED',
      trace: ['OPENING', 'FAILED'],
      message: 'Đã dừng theo yêu cầu người dùng.',
    };
  }

  // CRITICAL: NEVER return `status: 'skipped'` when the card was not found on the profile grid!
  // Returning `CARD_NOT_FOUND_ON_GRID` (`unverified`) lets the service worker open `job.url`
  // directly in the SAME TikTok tab and verify the real Like button state!
  if (!card) {
    return {
      status: 'unverified',
      code: 'CARD_NOT_FOUND_ON_GRID',
      stage: 'UNVERIFIED',
      trace: ['OPENING', 'UNVERIFIED'],
      message:
        'Chưa tìm thấy thẻ video trên lưới trang cá nhân — chuyển sang kiểm tra trực tiếp trang video để xác minh trạng thái nút Tim.',
    };
  }

  // 3. Scroll card into view and open video modal in the same tab
  try {
    card.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    if (!(await sleepUnlessActionAborted(250))) {
      return {
        status: 'failed',
        code: 'USER_ABORTED',
        stage: 'FAILED',
        trace: ['OPENING', 'FAILED'],
        message: 'Đã dừng theo yêu cầu người dùng.',
      };
    }
  } catch {
    /* ignore */
  }

  const modalOpened = await openVideoModal(card, videoId);
  if (isActionAborted()) {
    await closeModal(cleanAccount);
    return {
      status: 'failed',
      code: 'USER_ABORTED',
      stage: 'FAILED',
      trace: ['OPENING', 'FAILED'],
      message: 'Đã dừng theo yêu cầu người dùng.',
    };
  }
  if (!modalOpened) {
    if (detectUnavailable()) {
      return {
        status: 'unavailable',
        code: 'VIDEO_UNAVAILABLE',
        stage: 'FAILED',
        trace: ['OPENING', 'FAILED'],
        message: 'Video không khả dụng, riêng tư hoặc đã bị xóa',
      };
    }
    return {
      status: 'unverified',
      code: 'MODAL_NOT_OPENED',
      stage: 'UNVERIFIED',
      trace: ['OPENING', 'UNVERIFIED'],
      message: 'Chưa mở được khung xem video trên lưới — chuyển sang mở trực tiếp trên cùng tab.',
    };
  }

  try {
    // Brief frame settle; `removeLike` immediately runs WAITING_FOR_VIDEO -> WAITING_FOR_LIKE_BUTTON -> CHECKING_LIKE
    if (!(await sleepUnlessActionAborted(180))) {
      return {
        status: 'failed',
        code: 'USER_ABORTED',
        stage: 'FAILED',
        trace: ['OPENING', 'FAILED'],
        message: 'Đã dừng theo yêu cầu người dùng.',
      };
    }
    const targetUrl = url || window.location.href;
    if (action === 'remove_repost') {
      return await removeRepost(videoId, targetUrl, options);
    }
    return await removeLike(videoId, targetUrl, { initialTrace: ['OPENING'] });
  } finally {
    await closeModal(cleanAccount);
  }
}

export async function executePerform(
  action: 'remove_repost' | 'remove_like',
  videoId: string,
  account: string,
  url?: string,
  directVideoPage = false
): Promise<ActionResult> {
  const targetUrl = url || window.location.href;
  const path = window.location.pathname.toLowerCase();
  const cleanAccount = account ? account.replace(/^@/, '').toLowerCase() : '';
  const onProfile = Boolean(cleanAccount && path.includes(`/@${cleanAccount}`));

  if (action === 'remove_repost') {
    // Primary (yiitxyz/tiktokRepostRemover): direct sequential upvote/delete API in active TikTok session
    const apiRes = await removeRepost(videoId, targetUrl);
    if (apiRes.status === 'success' || apiRes.haltRun) {
      return apiRes;
    }
    // Fallback to in-page modal only if API returned a non-safety error and we are on the profile page
    if (onProfile && apiRes.code === 'API_REPOST_DELETE_FAILED') {
      return performActionOnProfile('remove_repost', videoId, account, url, { domOnly: true });
    }
    return apiRes;
  }

  // action === 'remove_like'
  const currentVideoId = extractVideoIdFromUrl(window.location.pathname);
  if (directVideoPage || (currentVideoId === videoId && isModalOpen())) {
    return removeLike(videoId, targetUrl, { initialTrace: ['OPENING'] });
  }
  if (cleanAccount) {
    return performActionOnProfile('remove_like', videoId, account, url);
  }
  return removeLike(videoId, targetUrl, { initialTrace: ['OPENING'] });
}

// TikTok Cleaner Pro Content Script Entry
(() => {
  if ((window as unknown as { __tiktokCleanerProLoaded?: boolean }).__tiktokCleanerProLoaded) {
    return;
  }
  (window as unknown as { __tiktokCleanerProLoaded?: boolean }).__tiktokCleanerProLoaded = true;

  try {
    chrome.runtime
      .sendMessage({
        type: 'CONTENT_READY',
        url: window.location.href,
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }

  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message: BgToContent, _sender, sendResponse) => {
    switch (message.type) {
      case 'PING': {
        const acc = detectAccount(document);
        const resp: PingResponse = {
          ok: true,
          url: window.location.href,
          account: {
            ...acc,
            checkedAt: Date.now(),
            tabId: null,
          },
          captcha: detectCaptcha(document),
          http403: detectHttp403(document),
        };
        sendResponse(resp);
        return false;
      }

      case 'DETECT_ACCOUNT': {
        const acc = detectAccount(document);
        sendResponse({
          ok: true,
          account: {
            ...acc,
            checkedAt: Date.now(),
            tabId: null,
          },
        });
        return false;
      }

      case 'SCAN_STOP': {
        stopScanning();
        sendResponse({ ok: true });
        return false;
      }

      case 'ACTION_STOP': {
        abortAction();
        sendResponse({ ok: true });
        return false;
      }

      case 'START_SCAN_TAB': {
        sendResponse({ ok: true, started: true });
        runScan(
          message.kind,
          message.username,
          message.limit,
          message.knownIds,
          message.secUid,
          Boolean(message.skipApi)
        ).catch((err) => {
          chrome.runtime
            .sendMessage({
              type: 'SCAN_DONE',
              kind: message.kind,
              total: 0,
              code: 'SCAN_ERROR',
              message: err instanceof Error ? err.message : String(err),
            })
            .catch(() => {});
        });
        return false;
      }

      case 'SCAN': {
        runScan(
          message.kind,
          message.username,
          message.limit,
          message.knownIds,
          message.secUid,
          Boolean(message.skipApi)
        )
          .then((result) => sendResponse(result))
          .catch((err) => {
            sendResponse({
              ok: false,
              code: 'SCAN_EXCEPTION',
              message: err instanceof Error ? err.message : String(err),
              total: 0,
            });
          });
        return true;
      }

      case 'VERIFY_REPOSTS': {
        resetActionAbort();
        verifyRepostsViaApi(message.secUid, '', message.pageLimit, isActionAborted)
          .then((res) => sendResponse(res))
          .catch((err) => {
            const code = err instanceof SafetyStopError ? err.code : 'VERIFY_ERROR';
            sendResponse({
              ok: false,
              code,
              error: err instanceof Error ? err.message : String(err),
              presentIds: [],
            });
          });
        return true;
      }

      case 'PERFORM': {
        resetActionAbort();
        executePerform(
          message.action,
          message.videoId,
          message.account,
          message.url,
          Boolean(message.directVideoPage)
        )
          .then((res) => sendResponse(res))
          .catch((err) => {
            sendResponse({
              status: 'failed',
              code: 'ACTION_EXCEPTION',
              message: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      default:
        return false;
    }
  });
})();
