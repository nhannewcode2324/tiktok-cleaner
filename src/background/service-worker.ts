import type {
  AccountInfo,
  ActionResult,
  HistoryEntry,
  ScannedVideo,
  VideoKind,
} from '../shared/types';
import type {
  BgResponse,
  MainWorldFetchResult,
  MainWorldSessionResult,
  PingResponse,
  UiToBg,
} from '../shared/messages';
import {
  applyResult,
  canResume,
  complete,
  createQueue,
  emptyQueue,
  isActive,
  markProcessing,
  nextPendingIndex,
  recoverAfterRestart,
  requestPause,
  resume,
  settlePause,
  stop,
  summarize,
} from '../services/automation-queue';
import { isEligible } from '../services/selection-manager';
import { emptyScan, storage } from '../services/storage-manager';
import { sleep, uid, videoKey } from '../shared/utils';
import { HALT_CODES, TIKTOK_MATCH_PATTERNS, TIKTOK_ORIGIN } from '../shared/constants';

let isLoopRunning = false;
let queueStopRequested = false;
let queuePauseRequested = false;
let activeQueueRunToken = 0;

let scanStopRequested = false;
let activeScanRunToken = 0;
let activeScanTabId: number | null = null;

// Promise-chain mutex to serialize concurrent storage read-modify-write operations
let storageMutex: Promise<void> = Promise.resolve();
function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = storageMutex.then(fn, fn);
  storageMutex = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function broadcastToTikTokTabs(
  msg: { type: 'SCAN_STOP' | 'ACTION_STOP' },
  extraTabId?: number | null
): Promise<void> {
  const sent = new Set<number>();
  if (typeof extraTabId === 'number') {
    sent.add(extraTabId);
    chrome.tabs.sendMessage(extraTabId, msg).catch(() => {});
  }
  try {
    const tabs = await chrome.tabs.query({ url: TIKTOK_MATCH_PATTERNS });
    for (const t of tabs) {
      if (t.id !== undefined && !sent.has(t.id)) {
        sent.add(t.id);
        chrome.tabs.sendMessage(t.id, msg).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
}

async function interruptibleSleep(ms: number, runToken: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (queueStopRequested || queuePauseRequested || activeQueueRunToken !== runToken) break;
    await sleep(Math.min(100, end - Date.now()));
    if (queueStopRequested || queuePauseRequested || activeQueueRunToken !== runToken) break;
    const q = await storage.getQueue();
    if (q.status !== 'running') break;
  }
}

// Set up SidePanel behavior on click
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  storage.getQueue().then((q) => {
    const recovered = recoverAfterRestart(q);
    if (recovered.status !== q.status || recovered.jobs.some((j, i) => j.status !== q.jobs[i]?.status)) {
      storage.setQueue(recovered);
      storage.appendLog({
        level: 'warn',
        message: 'Đã khôi phục hàng đợi sau khi tải lại tiện ích (Tạm dừng an toàn).',
      });
    }
  });
});

// Auto-reset to 0 on browser startup (khi thoát Chrome ra và mở lại)
chrome.runtime.onStartup.addListener(async () => {
  try {
    const acc = await storage.getAccount();
    if (acc?.username) {
      await storage.setVideos(acc.username, []);
      await storage.setSelection(acc.username, new Set());
      await storage.setResults(acc.username, {});
    }
    await storage.setQueue(emptyQueue());
    await storage.setScan(emptyScan());
    await storage.appendLog({
      level: 'info',
      message: 'Khởi động trình duyệt: Đã tự động đặt lại toàn bộ dữ liệu về 0.',
    });
  } catch {
    /* ignore */
  }
});

// ---------------------- MAIN-WORLD SESSION & FETCH HELPERS ----------------------

/**
 * Self-contained function injected into `world: 'MAIN'` (inspired by yiitxyz/tiktokRepostRemover)
 * to read TikTok's hydrated universal session data (`secUid` + `uniqueId`) without network calls.
 */
function readTikTokPageSessionInMainWorld(): MainWorldSessionResult {
  try {
    const title = (document.title || '').toLowerCase();
    const bodyText = (document.body?.innerText || '').slice(0, 600).toLowerCase();
    const http403 =
      title.includes('403 forbidden') ||
      title.includes('access denied') ||
      (bodyText.includes('http error 403') && bodyText.includes('denied')) ||
      (bodyText.includes('access to') && bodyText.includes('was denied') && bodyText.includes('tiktok.com'));

    const win = window as unknown as {
      __$UNIVERSAL_DATA$__?: {
        __DEFAULT_SCOPE__?: Record<
          string,
          {
            user?: {
              secUid?: string;
              uniqueId?: string;
              uid?: string;
            };
          }
        >;
      };
      SIGI_STATE?: {
        AppContext?: {
          appContext?: {
            user?: {
              secUid?: string;
              uniqueId?: string;
              uid?: string;
            };
          };
        };
      };
    };

    let user = win.__$UNIVERSAL_DATA$__?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user;

    if (!user?.secUid && !user?.uniqueId) {
      const scriptEl = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (scriptEl?.textContent) {
        try {
          const parsed = JSON.parse(scriptEl.textContent);
          user = parsed?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user;
        } catch {
          /* ignore */
        }
      }
    }

    if (!user?.secUid && !user?.uniqueId) {
      user = win.SIGI_STATE?.AppContext?.appContext?.user;
    }

    const username = user?.uniqueId ? String(user.uniqueId).replace(/^@/, '').trim() : null;
    const secUid = user?.secUid ? String(user.secUid).trim() : null;
    const userId = user?.uid ? String(user.uid).trim() : null;

    return {
      loggedIn: Boolean(username || secUid),
      username: username || null,
      secUid: secUid || null,
      uid: userId || null,
      http403,
    };
  } catch {
    return {
      loggedIn: false,
      username: null,
      secUid: null,
      uid: null,
      http403: false,
    };
  }
}

async function getPageSessionFromMainWorld(tabId: number): Promise<MainWorldSessionResult | null> {
  try {
    if (!chrome.scripting?.executeScript) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readTikTokPageSessionInMainWorld,
    });
    return (results?.[0]?.result as MainWorldSessionResult | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Executes a first-party TikTok web request inside `world: 'MAIN'` so TikTok's own
 * loaded web SDK (`webmssdk`) attaches standard request parameters & session cookies.
 */
async function executeMainWorldFetch(
  tabId: number,
  req: {
    pathAndQuery: string;
    method: 'GET' | 'POST';
    body?: string;
    headers?: Record<string, string>;
    timeoutMs: number;
  }
): Promise<MainWorldFetchResult> {
  try {
    if (!chrome.scripting?.executeScript) {
      return { ok: false, status: 0, data: null, networkError: 'Scripting API unavailable' };
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [req.pathAndQuery, req.method, req.body ?? null, req.headers ?? null, req.timeoutMs],
      func: async (
        pathAndQuery: string,
        method: 'GET' | 'POST',
        body: string | null,
        headers: Record<string, string> | null,
        timeoutMs: number
      ): Promise<MainWorldFetchResult> => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
          const url = pathAndQuery.startsWith('http')
            ? pathAndQuery
            : `${window.location.origin}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
          const init: RequestInit = {
            method,
            credentials: 'include',
            signal: controller.signal,
          };
          if (headers) init.headers = headers;
          if (body !== null && method !== 'GET') init.body = body;

          const response = await window.fetch(url, init);
          const text = await response.text();
          let data: unknown = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = null;
            }
          }
          return {
            ok: response.ok,
            status: response.status,
            data,
          };
        } catch (err) {
          const timedOut = err instanceof DOMException && err.name === 'AbortError';
          return {
            ok: false,
            status: 0,
            data: null,
            timedOut,
            networkError: err instanceof Error ? err.message : String(err),
          };
        } finally {
          window.clearTimeout(timer);
        }
      },
    });
    return (
      (results?.[0]?.result as MainWorldFetchResult | undefined) ?? {
        ok: false,
        status: 0,
        data: null,
        networkError: 'Empty script result',
      }
    );
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------- TAB MANAGEMENT ----------------------

async function findTikTokTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ url: TIKTOK_MATCH_PATTERNS });
  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.active && t.id !== undefined);
  return active || tabs.find((t) => t.id !== undefined) || null;
}

/** True when both URLs point to the same TikTok path (host-insensitive across www.tiktok.com / tiktok.com). */
function sameTikTokPath(a?: string, b?: string): boolean {
  try {
    const pa = new URL(a || '').pathname.replace(/\/+$/, '').toLowerCase();
    const pb = new URL(b || '').pathname.replace(/\/+$/, '').toLowerCase();
    return pa === pb;
  } catch {
    return false;
  }
}

/**
 * Reuses an existing TikTok tab without reloading it unless `targetUrl` is explicitly provided
 * and points to a different path. Never opens duplicate TikTok tabs.
 */
async function ensureTikTokTab(targetUrl?: string): Promise<chrome.tabs.Tab> {
  const tab = await findTikTokTab();
  if (tab && tab.id !== undefined) {
    if (targetUrl && !sameTikTokPath(tab.url, targetUrl)) {
      return chrome.tabs.update(tab.id, { url: targetUrl, active: true });
    }
    return chrome.tabs.update(tab.id, { active: true });
  }
  return chrome.tabs.create({ url: targetUrl || `${TIKTOK_ORIGIN}/`, active: true });
}

async function waitForTabComplete(tabId: number, timeoutMs = 12000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete' && t.url && t.url.includes('tiktok.com')) {
        return true;
      }
    } catch {
      return false;
    }
    await sleep(300);
  }
  return false;
}

async function pingTab(tabId: number): Promise<PingResponse | null> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res && res.ok) return res as PingResponse;
  } catch {
    try {
      if (chrome.scripting?.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        await sleep(300);
        const res2 = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        if (res2 && res2.ok) return res2 as PingResponse;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('tiktok.com')) {
    checkAccount(tabId).catch(() => {});
  }
});

async function checkAccount(tabId?: number): Promise<AccountInfo> {
  let targetTabId = tabId;
  if (!targetTabId) {
    const tab = await findTikTokTab();
    targetTabId = tab?.id;
  }

  if (!targetTabId) {
    const cached = await storage.getAccount();
    if (cached) return { ...cached, tabId: null };
    return { loggedIn: false, username: null, secUid: null, source: 'none', checkedAt: Date.now(), tabId: null };
  }

  // 1. Primary: Read universal hydrated session directly from MAIN world (gets both username & secUid)
  const mainSession = await getPageSessionFromMainWorld(targetTabId);
  if (mainSession && mainSession.loggedIn && mainSession.username) {
    const acc: AccountInfo = {
      loggedIn: true,
      username: mainSession.username,
      secUid: mainSession.secUid,
      source: 'main',
      checkedAt: Date.now(),
      tabId: targetTabId,
    };
    await storage.setAccount(acc);
    return acc;
  }

  // 2. Secondary: Content script DOM/script inspection
  const ping = await pingTab(targetTabId);
  if (ping && ping.account && ping.account.loggedIn && ping.account.username) {
    const cached = await storage.getAccount();
    const preservedSecUid =
      mainSession?.secUid ||
      (cached?.username?.toLowerCase() === ping.account.username.toLowerCase() ? cached.secUid : null) ||
      null;
    const acc: AccountInfo = {
      ...ping.account,
      secUid: preservedSecUid,
      tabId: targetTabId,
      checkedAt: Date.now(),
    };
    await storage.setAccount(acc);
    return acc;
  }

  // Preserve valid cached account if page is still hydrating (and not explicitly logged out)
  const cached = await storage.getAccount();
  if (cached && cached.loggedIn && cached.username && mainSession === null) {
    return { ...cached, tabId: targetTabId };
  }

  const disconnected: AccountInfo = {
    loggedIn: false,
    username: null,
    secUid: null,
    source: 'none',
    checkedAt: Date.now(),
    tabId: targetTabId,
  };
  await storage.setAccount(disconnected);
  return disconnected;
}

async function navigateAndWaitForProfile(
  tabId: number,
  username: string,
  timeoutMs = 15000,
  shouldAbort?: () => boolean
): Promise<{ ok: boolean; http403?: boolean; aborted?: boolean }> {
  const cleanUsername = username.replace(/^@/, '');
  const profileUrl = `${TIKTOK_ORIGIN}/@${cleanUsername}`;
  const targetSubstr = `/@${cleanUsername.toLowerCase()}`;

  try {
    if (shouldAbort?.()) return { ok: false, aborted: true };
    const curTab = await chrome.tabs.get(tabId);
    const curUrl = (curTab.url || '').toLowerCase();

    if (curUrl.includes(targetSubstr)) {
      for (let i = 0; i < 10; i++) {
        if (shouldAbort?.()) return { ok: false, aborted: true };
        const ping = await pingTab(tabId);
        if (ping?.http403) return { ok: false, http403: true };
        if (ping?.ok) return { ok: true };
        await sleep(300);
      }
      return { ok: true };
    }

    await chrome.tabs.update(tabId, { url: profileUrl, active: true });

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (shouldAbort?.()) return { ok: false, aborted: true };
      await sleep(300);
      if (shouldAbort?.()) return { ok: false, aborted: true };
      try {
        const t = await chrome.tabs.get(tabId);
        const url = (t.url || '').toLowerCase();
        if (url.includes('tiktok.com') && t.status === 'complete') {
          const ping = await pingTab(tabId);
          if (ping?.http403) {
            return { ok: false, http403: true };
          }
          if (url.includes(targetSubstr) && ping?.ok) {
            await sleep(400);
            return shouldAbort?.() ? { ok: false, aborted: true } : { ok: true };
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return shouldAbort?.() ? { ok: false, aborted: true } : { ok: false };
}

async function navigateAndWaitForDirectVideo(
  tabId: number,
  videoUrl: string,
  videoId: string,
  timeoutMs = 15000,
  shouldAbort?: () => boolean
): Promise<{ ok: boolean; http403?: boolean; captcha?: boolean; aborted?: boolean }> {
  try {
    if (shouldAbort?.()) return { ok: false, aborted: true };
    await chrome.tabs.update(tabId, { url: videoUrl });

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (shouldAbort?.()) return { ok: false, aborted: true };
      await sleep(300);
      if (shouldAbort?.()) return { ok: false, aborted: true };

      try {
        const t = await chrome.tabs.get(tabId);
        const url = t.url || '';
        if (url.includes('tiktok.com') && t.status === 'complete') {
          const ping = await pingTab(tabId);
          if (ping?.http403) return { ok: false, http403: true };
          if (ping?.captcha) return { ok: false, captcha: true };
          if (ping?.ok && url.includes(videoId)) {
            await sleep(350);
            return shouldAbort?.() ? { ok: false, aborted: true } : { ok: true };
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return shouldAbort?.() ? { ok: false, aborted: true } : { ok: false };
}

// ---------------------- AUTOMATION QUEUE RUNNER ----------------------

async function revertJobToPending(jobIdx: number, reasonCode: string, reason: string): Promise<void> {
  await withStorageLock(async () => {
    const q = await storage.getQueue();
    const jobs = q.jobs.map((j, idx) =>
      idx === jobIdx && j.status === 'processing'
        ? { ...j, status: 'pending' as const, attempts: Math.max(0, j.attempts - 1) }
        : j
    );
    const preserveStopped = q.status === 'stopped' || queueStopRequested;
    await storage.setQueue({
      ...q,
      status: preserveStopped ? 'stopped' : 'paused',
      reasonCode: preserveStopped ? q.reasonCode || 'STOPPED' : reasonCode,
      reason: preserveStopped ? q.reason || 'Đã dừng theo yêu cầu người dùng.' : reason,
      jobs,
    });
  });
}

async function settleUserInterrupt(jobIdx?: number): Promise<void> {
  await withStorageLock(async () => {
    let q = await storage.getQueue();
    const jobs = q.jobs.map((j, idx) =>
      (jobIdx === undefined || idx === jobIdx) && j.status === 'processing'
        ? { ...j, status: 'pending' as const, attempts: Math.max(0, j.attempts - 1) }
        : j
    );
    q = { ...q, jobs };

    if (queueStopRequested || q.status === 'stopped') {
      q = {
        ...q,
        status: 'stopped',
        reasonCode: q.reasonCode || 'STOPPED',
        reason: q.reason || 'Đã dừng theo yêu cầu người dùng (tiến độ được giữ nguyên)',
        finishedAt: q.finishedAt || Date.now(),
      };
    } else if (queuePauseRequested || q.status === 'pausing' || q.status === 'paused') {
      q = {
        ...settlePause(q),
        status: 'paused',
        reasonCode: q.reasonCode || 'USER_PAUSE',
        reason: q.reason || 'Đã tạm dừng theo yêu cầu người dùng.',
      };
    }
    await storage.setQueue(q);
  });
}

async function verifyRemovedRepostsOnServer(tabId: number, account: string, secUid: string): Promise<void> {
  if (queueStopRequested || queuePauseRequested) return;
  const queue = await storage.getQueue();
  const succeededRepostJobs = queue.jobs.filter(
    (j) => j.action === 'remove_repost' && j.status === 'success'
  );
  if (succeededRepostJobs.length === 0) return;

  const videos = await storage.getVideos(account);
  const videoByKey = new Map(videos.map((v) => [v.key, v]));
  let maxScanPage = 1;
  for (const job of succeededRepostJobs) {
    const v = videoByKey.get(job.key);
    if (v?.scanPage && v.scanPage > maxScanPage) {
      maxScanPage = v.scanPage;
    }
  }
  const pageLimit = Math.max(1, Math.min(maxScanPage, 15));

  await storage.appendLog({
    level: 'info',
    message: `Đang xác minh kết quả xóa Repost với máy chủ TikTok (tối đa ${pageLimit} trang)...`,
    account,
  });

  try {
    const verifyRes = (await chrome.tabs.sendMessage(tabId, {
      type: 'VERIFY_REPOSTS',
      secUid,
      pageLimit,
    })) as { ok: boolean; presentIds?: string[] } | undefined;

    if (queueStopRequested || queuePauseRequested) return;
    if (!verifyRes?.ok || !Array.isArray(verifyRes.presentIds)) return;

    const stillPresent = new Set(verifyRes.presentIds);
    const failedVerifyKeys = new Set<string>();
    for (const job of succeededRepostJobs) {
      if (stillPresent.has(job.videoId)) {
        failedVerifyKeys.add(job.key);
      }
    }

    if (failedVerifyKeys.size === 0) return;

    await withStorageLock(async () => {
      const latestQueue = await storage.getQueue();
      const results = await storage.getResults(account);
      const selSet = await storage.getSelection(account);
      const now = Date.now();

      const updatedJobs = latestQueue.jobs.map((j) => {
        if (!failedVerifyKeys.has(j.key)) return j;
        results[j.key] = {
          status: 'failed',
          error: 'Repost vẫn còn trên TikTok sau khi xác minh máy chủ.',
          processedAt: now,
        };
        selSet.add(j.key);
        return {
          ...j,
          status: 'failed' as const,
          error: 'Repost vẫn còn trên TikTok sau khi xác minh máy chủ.',
          errorCode: 'SERVER_VERIFY_STILL_PRESENT',
          processedAt: now,
        };
      });

      await storage.setResults(account, results);
      await storage.setSelection(account, selSet);
      await storage.setQueue({ ...latestQueue, jobs: updatedJobs });
    });

    await storage.appendLog({
      level: 'warn',
      message: `Xác minh máy chủ: ${failedVerifyKeys.size} video vẫn còn trạng thái Repost và đã được đánh dấu Thất bại để thử lại.`,
      account,
    });
  } catch {
    /* verification is best-effort; do not fail completed run on transient verify error */
  }
}

async function runQueueLoop(runToken: number) {
  if (isLoopRunning) return;
  isLoopRunning = true;

  const isInterrupted = () =>
    queueStopRequested || queuePauseRequested || activeQueueRunToken !== runToken;

  let attemptsInGroup = 0;
  let groupTarget = randomBetween(35, 45);
  let activatedTabOnce = false;

  try {
    while (true) {
      if (isInterrupted()) {
        await settleUserInterrupt();
        break;
      }

      let queue = await storage.getQueue();
      if (queue.status === 'pausing') {
        await settleUserInterrupt();
        await storage.appendLog({ level: 'info', message: 'Đã tạm dừng hàng đợi dọn dẹp.' });
        break;
      }

      if (queue.status !== 'running') {
        break;
      }

      const pendingIdx = nextPendingIndex(queue);
      if (pendingIdx === -1) {
        const acc = await storage.getAccount();
        if (!isInterrupted() && queue.workerTabId && queue.account && acc?.secUid) {
          await verifyRemovedRepostsOnServer(queue.workerTabId, queue.account, acc.secUid);
        }

        if (isInterrupted()) {
          await settleUserInterrupt();
          break;
        }

        const now = Date.now();
        let completedSummary: ReturnType<typeof summarize> | null = null;
        await withStorageLock(async () => {
          const latest = await storage.getQueue();
          if (latest.status !== 'running') return;
          const doneQueue = complete(latest, now);
          await storage.setQueue(doneQueue);
          queue = doneQueue;
          completedSummary = summarize(doneQueue);
        });

        if (completedSummary) {
          const s = completedSummary as ReturnType<typeof summarize>;
          const historyEntry: HistoryEntry = {
            runId: queue.runId || uid('run'),
            account: queue.account,
            startedAt: queue.startedAt,
            finishedAt: now,
            total: s.total,
            success: s.success,
            failed: s.failed,
            unverified: s.unverified,
            skipped: s.skipped,
            unavailable: s.unavailable,
            endStatus: 'completed',
            reason: null,
          };
          await storage.addHistory(historyEntry);
          await storage.appendLog({
            level: 'success',
            message: `Hoàn tất dọn dẹp! Thành công: ${s.success}, Bỏ qua (đã xác minh): ${s.skipped}, Chưa xác minh: ${s.unverified}, Thất bại: ${s.failed}, Bị ẩn/xóa: ${s.unavailable}.`,
            account: queue.account,
          });
        }
        break;
      }

      // Mark processing safely under storage lock
      let markedOk = false;
      await withStorageLock(async () => {
        const latest = await storage.getQueue();
        if (latest.status !== 'running' || isInterrupted()) return;
        queue = markProcessing(latest, pendingIdx);
        await storage.setQueue(queue);
        markedOk = true;
      });
      if (!markedOk) {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      const job = queue.jobs[pendingIdx];

      // Reuse single TikTok worker tab throughout the entire run
      let workerTab: chrome.tabs.Tab | null = null;
      if (queue.workerTabId) {
        try {
          const existing = await chrome.tabs.get(queue.workerTabId);
          if (existing && existing.id !== undefined) workerTab = existing;
        } catch {
          workerTab = null;
        }
      }

      if (!workerTab || workerTab.id === undefined) {
        workerTab = await findTikTokTab();
      }

      if (!workerTab || workerTab.id === undefined) {
        if (isInterrupted()) {
          await settleUserInterrupt(pendingIdx);
          break;
        }
        workerTab = await ensureTikTokTab();
        if (workerTab.id !== undefined) {
          await waitForTabComplete(workerTab.id, 12000);
        }
      }

      if (isInterrupted()) {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      const tabId = workerTab.id!;
      if (!activatedTabOnce) {
        activatedTabOnce = true;
        await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      }

      if (queue.workerTabId !== tabId) {
        await withStorageLock(async () => {
          const latest = await storage.getQueue();
          if (latest.status === 'running' && !isInterrupted()) {
            queue = { ...latest, workerTabId: tabId };
            await storage.setQueue(queue);
          }
        });
      }

      if (isInterrupted()) {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      // Safety check: HTTP 403 / CAPTCHA before action
      const initialPing = await pingTab(tabId);
      if (isInterrupted()) {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      if (initialPing?.http403) {
        const msg = 'Phát hiện lỗi HTTP 403 (Access Denied) trên TikTok. Đã dừng ngay và lưu tiến độ để bảo vệ tài khoản.';
        await revertJobToPending(pendingIdx, 'HTTP_403', msg);
        await storage.appendLog({
          level: 'error',
          message: msg,
          videoId: job.videoId,
          action: job.action,
          account: queue.account,
        });
        break;
      }

      if (initialPing?.captcha) {
        const msg = 'Phát hiện CAPTCHA trên TikTok. Vui lòng hoàn tất xác minh rồi nhấn Tiếp tục.';
        await revertJobToPending(pendingIdx, 'CAPTCHA', msg);
        await storage.appendLog({
          level: 'warn',
          message: msg,
          videoId: job.videoId,
          action: job.action,
          account: queue.account,
        });
        break;
      }

      // Verify signed-in account has not changed mid-run
      const currentAcc = await checkAccount(tabId);
      if (isInterrupted()) {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      if (
        currentAcc.username &&
        queue.account &&
        currentAcc.username.toLowerCase() !== queue.account.toLowerCase()
      ) {
        const msg = `Tài khoản TikTok đã đổi từ @${queue.account} sang @${currentAcc.username}. Đã tạm dừng an toàn.`;
        await revertJobToPending(pendingIdx, 'ACCOUNT_MISMATCH', msg);
        await storage.appendLog({
          level: 'error',
          message: msg,
          videoId: job.videoId,
          action: job.action,
        });
        break;
      }

      // Navigation policy:
      // - For `remove_repost`: NEVER force profile navigation — executes sequential upvote/delete directly on current tab!
      // - For `remove_like`: Ensure worker tab is on `/@account` once so the Liked tab video modal can open in-page.
      const cleanAccount = (queue.account || '').replace(/^@/, '');
      if (job.action === 'remove_like' && cleanAccount) {
        const navRes = await navigateAndWaitForProfile(tabId, cleanAccount, 15000, isInterrupted);
        if (navRes.aborted || isInterrupted()) {
          await settleUserInterrupt(pendingIdx);
          break;
        }
        if (navRes.http403) {
          const msg = 'TikTok trả về HTTP 403 khi mở trang cá nhân. Đã dừng ngay và lưu tiến độ.';
          await revertJobToPending(pendingIdx, 'HTTP_403', msg);
          await storage.appendLog({ level: 'error', message: msg, account: queue.account });
          break;
        }
        if (!navRes.ok) {
          const msg = `Không thể tải trang cá nhân @${cleanAccount}. Đã tạm dừng và lưu tiến độ.`;
          await revertJobToPending(pendingIdx, 'PROFILE_LOAD_TIMEOUT', msg);
          await storage.appendLog({ level: 'error', message: msg, account: queue.account });
          break;
        }
      }

      // Ensure content script is responsive
      const readyPing = await pingTab(tabId);
      if (isInterrupted()) {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      if (readyPing?.http403) {
        const msg = 'Phát hiện lỗi HTTP 403 trên TikTok. Đã tạm dừng và lưu tiến độ.';
        await revertJobToPending(pendingIdx, 'HTTP_403', msg);
        await storage.appendLog({ level: 'error', message: msg, account: queue.account });
        break;
      }

      let outcomeResult: ActionResult;
      if (!readyPing?.ok) {
        outcomeResult = {
          status: 'failed',
          code: 'PAGE_LOAD_TIMEOUT',
          message: 'Không thể kết nối với tab TikTok để thực hiện thao tác.',
        };
      } else {
        try {
          const actionResponse = (await chrome.tabs.sendMessage(tabId, {
            type: 'PERFORM',
            action: job.action,
            videoId: job.videoId,
            account: queue.account || '',
            url: job.url,
          })) as ActionResult;
          outcomeResult = actionResponse || {
            status: 'failed',
            code: 'EMPTY_RESPONSE',
            message: 'Không nhận được phản hồi từ trang TikTok.',
          };
        } catch (err) {
          outcomeResult = {
            status: 'failed',
            code: 'COMMUNICATION_ERROR',
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // If the content script aborted cleanly BEFORE clicking because user clicked Stop / Pause,
      // revert the unclicked job back to 'pending' without recording a false failure.
      if (outcomeResult.code === 'USER_ABORTED') {
        await settleUserInterrupt(pendingIdx);
        break;
      }

      // Single-tab direct video fallback for Likes:
      // NEVER skip a video just because its thumbnail wasn't mounted in the profile grid or modal didn't open!
      // Instead, open `job.url` directly in the SAME TikTok worker tab and run the full Like state machine.
      if (
        job.action === 'remove_like' &&
        (outcomeResult.code === 'CARD_NOT_FOUND_ON_GRID' || outcomeResult.code === 'MODAL_NOT_OPENED') &&
        job.url &&
        /\/(?:video|photo)\/\d+/.test(job.url)
      ) {
        await storage.appendLog({
          level: 'info',
          message: `[Like] Video ${job.videoId}: ${outcomeResult.message} Đang mở trực tiếp trên cùng tab để kiểm tra nút Tim...`,
          videoId: job.videoId,
          action: job.action,
          account: queue.account,
        });

        const directNav = await navigateAndWaitForDirectVideo(
          tabId,
          job.url,
          job.videoId,
          15000,
          isInterrupted
        );

        if (directNav.aborted || isInterrupted()) {
          await settleUserInterrupt(pendingIdx);
          break;
        }
        if (directNav.http403) {
          const msg = 'TikTok trả về HTTP 403 khi mở trực tiếp video. Đã dừng ngay và lưu tiến độ.';
          await revertJobToPending(pendingIdx, 'HTTP_403', msg);
          await storage.appendLog({ level: 'error', message: msg, videoId: job.videoId, action: job.action, account: queue.account });
          break;
        }
        if (directNav.captcha) {
          const msg = 'Phát hiện CAPTCHA khi mở trực tiếp video. Vui lòng hoàn tất xác minh rồi nhấn Tiếp tục.';
          await revertJobToPending(pendingIdx, 'CAPTCHA', msg);
          await storage.appendLog({ level: 'warn', message: msg, videoId: job.videoId, action: job.action, account: queue.account });
          break;
        }

        if (directNav.ok) {
          try {
            const directRes = (await chrome.tabs.sendMessage(tabId, {
              type: 'PERFORM',
              action: job.action,
              videoId: job.videoId,
              account: queue.account || '',
              url: job.url,
              directVideoPage: true,
            })) as ActionResult;
            if (directRes) {
              outcomeResult = directRes;
            }
          } catch (err) {
            outcomeResult = {
              status: 'unverified',
              code: 'DIRECT_VIDEO_COMM_ERROR',
              stage: 'UNVERIFIED',
              message: `Không thể đọc trạng thái nút Tim trên trang video (${err instanceof Error ? err.message : String(err)})`,
            };
          }
        } else {
          outcomeResult = {
            status: 'unverified',
            code: 'DIRECT_VIDEO_LOAD_TIMEOUT',
            stage: 'UNVERIFIED',
            message: 'Hết thời gian chờ tải trang video trực tiếp — đánh dấu UNVERIFIED (không tự SKIPPED).',
          };
        }

        if (outcomeResult.code === 'USER_ABORTED') {
          await settleUserInterrupt(pendingIdx);
          break;
        }
      }

      const settings = await storage.getSettings();
      let halted = false;
      let interruptedAfterAction = false;

      await withStorageLock(async () => {
        const latestQueue = await storage.getQueue();
        const wasStopped = queueStopRequested || latestQueue.status === 'stopped';
        const wasPaused =
          queuePauseRequested || latestQueue.status === 'pausing' || latestQueue.status === 'paused';

        // Re-ensure job is marked 'processing' if `stop()` reverted it while click was already completing
        let baseQueue = latestQueue;
        if (baseQueue.jobs[pendingIdx]?.status === 'pending') {
          baseQueue = markProcessing(baseQueue, pendingIdx);
        }

        const outcome = applyResult(baseQueue, pendingIdx, outcomeResult, {
          retryLimit: settings.retryLimit,
          stopOnConsecutiveErrors: settings.stopOnConsecutiveErrors,
          now: Date.now(),
        });

        halted = outcome.halted;
        let nextQueue = outcome.queue;
        if (wasStopped) {
          nextQueue = {
            ...nextQueue,
            status: 'stopped',
            reasonCode: latestQueue.reasonCode || 'STOPPED',
            reason: latestQueue.reason || 'Đã dừng theo yêu cầu người dùng (tiến độ được giữ nguyên)',
            finishedAt: latestQueue.finishedAt || Date.now(),
          };
          interruptedAfterAction = true;
        } else if (wasPaused) {
          nextQueue = {
            ...settlePause(nextQueue),
            status: 'paused',
            reasonCode: latestQueue.reasonCode || 'USER_PAUSE',
            reason: latestQueue.reason || 'Đã tạm dừng theo yêu cầu người dùng.',
          };
          interruptedAfterAction = true;
        }

        queue = nextQueue;
        await storage.setQueue(queue);

        if (queue.account) {
          const results = await storage.getResults(queue.account);
          results[job.key] = {
            status: outcomeResult.status,
            error: outcomeResult.status === 'success' ? null : outcomeResult.message,
            processedAt: Date.now(),
          };
          await storage.setResults(queue.account, results);

          if (outcomeResult.status === 'success' || outcomeResult.status === 'skipped') {
            const selSet = await storage.getSelection(queue.account);
            selSet.delete(job.key);
            await storage.setSelection(queue.account, selSet);
          }
        }
      });

      const logLvl =
        outcomeResult.status === 'success'
          ? 'success'
          : outcomeResult.status === 'skipped'
            ? 'info'
            : outcomeResult.status === 'unavailable' || outcomeResult.status === 'unverified'
              ? 'warn'
              : 'error';

      const stageSuffix = outcomeResult.trace?.length
        ? ` [${outcomeResult.trace.join(' → ')}]`
        : outcomeResult.stage
          ? ` [${outcomeResult.stage}]`
          : '';
      const statusDetail =
        outcomeResult.status === 'skipped'
          ? `[SKIPPED | Lý do: ${outcomeResult.skipReason || outcomeResult.code}] `
          : outcomeResult.status === 'unverified'
            ? `[UNVERIFIED | ${outcomeResult.code}] `
            : '';

      await storage.appendLog({
        level: logLvl,
        message: `[${job.action === 'remove_repost' ? 'Repost' : 'Like'}] Video ${job.videoId}: ${statusDetail}${outcomeResult.message}${stageSuffix}`,
        videoId: job.videoId,
        action: job.action,
        account: queue.account,
      });

      if (interruptedAfterAction) {
        break;
      }

      if (halted) {
        await storage.appendLog({
          level: 'warn',
          message: `Đã tạm dừng hàng đợi an toàn: ${queue.reason || 'Đạt ngưỡng bảo vệ tài khoản'}`,
          account: queue.account,
        });
        break;
      }

      // Check if more jobs remain before sleeping
      const afterQueue = await storage.getQueue();
      if (isInterrupted() || afterQueue.status !== 'running' || nextPendingIndex(afterQueue) === -1) {
        if (isInterrupted()) await settleUserInterrupt();
        continue;
      }

      // Pacing & group cooldown (inspired by yiitxyz/tiktokRepostRemover: 4-7s pause every 35-45 actions)
      attemptsInGroup += 1;
      if (attemptsInGroup >= groupTarget) {
        attemptsInGroup = 0;
        groupTarget = randomBetween(35, 45);
        await interruptibleSleep(randomBetween(4000, 7000), runToken);
      } else {
        const baseDelay = Math.max(1000, settings.actionDelay * 1000);
        await interruptibleSleep(baseDelay + randomBetween(150, 750), runToken);
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await withStorageLock(async () => {
      const q = await storage.getQueue();
      if (q.status === 'stopped' || queueStopRequested) return;
      await storage.setQueue({
        ...q,
        status: 'paused',
        reasonCode: 'UNHANDLED_RUNNER_ERROR',
        reason: errorMsg,
      });
    });
    await storage.appendLog({ level: 'error', message: `Lỗi tiến trình dọn dẹp: ${errorMsg}` });
  } finally {
    isLoopRunning = false;
  }
}

// ---------------------- SCANNING LOGIC ----------------------

interface ScanDonePayload {
  kind: VideoKind;
  total: number;
  code: string;
  message: string;
  haltRun?: boolean;
}

async function runSingleTabScanAttempt(
  tabId: number,
  scanToken: number,
  params: {
    kind: VideoKind;
    username: string;
    secUid?: string | null;
    skipApi?: boolean;
    limit: number;
    knownIds: string[];
  }
): Promise<ScanDonePayload> {
  return new Promise<ScanDonePayload>((resolve) => {
    let resolved = false;
    let checkInterval: ReturnType<typeof setInterval> | null = null;

    const finish = (payload: ScanDonePayload) => {
      if (resolved) return;
      resolved = true;
      if (checkInterval) clearInterval(checkInterval);
      chrome.runtime.onMessage.removeListener(doneListener);
      resolve(payload);
    };

    if (scanStopRequested || activeScanRunToken !== scanToken) {
      finish({
        kind: params.kind,
        total: 0,
        code: 'CANCELLED',
        message: 'Đã dừng quét theo yêu cầu.',
      });
      return;
    }

    const doneListener = (msg: any) => {
      if (msg && msg.type === 'SCAN_DONE' && msg.kind === params.kind) {
        finish({
          kind: params.kind,
          total: typeof msg.total === 'number' ? msg.total : 0,
          code: msg.code || 'COMPLETED',
          message: msg.message || '',
          haltRun: Boolean(msg.haltRun),
        });
      }
    };
    chrome.runtime.onMessage.addListener(doneListener);

    checkInterval = setInterval(async () => {
      if (resolved) return;
      if (scanStopRequested || activeScanRunToken !== scanToken) {
        finish({
          kind: params.kind,
          total: 0,
          code: 'CANCELLED',
          message: 'Đã dừng quét theo yêu cầu.',
        });
        return;
      }
      const s = await storage.getScan();
      if (s.status !== 'scanning') {
        finish({
          kind: params.kind,
          total: 0,
          code: 'CANCELLED',
          message: 'Đã dừng quét theo yêu cầu.',
        });
        return;
      }
      try {
        const t = await chrome.tabs.get(tabId);
        if (!t) throw new Error('Tab closed');
      } catch {
        finish({
          kind: params.kind,
          total: 0,
          code: 'TAB_CLOSED',
          message: 'Tab TikTok đã bị đóng trong khi quét.',
          haltRun: true,
        });
      }
    }, 250);

    chrome.tabs
      .sendMessage(tabId, {
        type: 'START_SCAN_TAB',
        kind: params.kind,
        username: params.username,
        secUid: params.secUid,
        skipApi: params.skipApi,
        limit: params.limit,
        knownIds: params.knownIds,
      })
      .catch((err) => {
        finish({
          kind: params.kind,
          total: 0,
          code: 'COMMUNICATION_ERROR',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  });
}

async function startScanFlow(kinds: VideoKind[], scanToken: number) {
  const isScanStopped = () => scanStopRequested || activeScanRunToken !== scanToken;

  const curScan = await storage.getScan();
  if (curScan.status === 'scanning') return;

  const curQueue = await storage.getQueue();
  if (isActive(curQueue)) {
    await storage.setScan({
      status: 'error',
      account: curQueue.account,
      kinds,
      currentKind: null,
      found: 0,
      newFound: 0,
      message: 'Đang chạy dọn dẹp video. Vui lòng tạm dừng hoặc đợi hoàn tất trước khi quét mới.',
      code: 'QUEUE_ACTIVE',
      startedAt: Date.now(),
      finishedAt: Date.now(),
    });
    return;
  }

  // Reuse existing open TikTok tab WITHOUT forcing URL navigation (prevents HTTP 403!)
  const tab = await ensureTikTokTab();
  if (tab.id === undefined || isScanStopped()) return;
  activeScanTabId = tab.id;
  await waitForTabComplete(tab.id, 12000);
  if (isScanStopped()) return;

  const initialPing = await pingTab(tab.id);
  if (isScanStopped()) return;
  if (initialPing?.http403) {
    await storage.setScan({
      status: 'error',
      account: null,
      kinds,
      currentKind: null,
      found: 0,
      newFound: 0,
      message: 'Trang TikTok hiện đang báo lỗi HTTP 403 (Access Denied). Vui lòng tải lại trang hoặc đợi vài phút trước khi quét.',
      code: 'HTTP_403',
      startedAt: Date.now(),
      finishedAt: Date.now(),
    });
    return;
  }

  let acc = await checkAccount(tab.id);
  if (!acc.loggedIn || !acc.username) {
    for (let i = 0; i < 6 && !isScanStopped(); i++) {
      await sleep(500);
      acc = await checkAccount(tab.id);
      if (acc.loggedIn && acc.username) break;
    }
  }
  if (isScanStopped()) return;

  if (!acc.loggedIn || !acc.username) {
    await storage.setScan({
      status: 'error',
      account: null,
      kinds,
      currentKind: null,
      found: 0,
      newFound: 0,
      message: 'Vui lòng đăng nhập tài khoản TikTok trên trình duyệt trước khi quét.',
      code: 'NOT_LOGGED_IN',
      startedAt: Date.now(),
      finishedAt: Date.now(),
    });
    return;
  }

  const cleanUsername = acc.username.replace(/^@/, '');
  const settings = await storage.getSettings();
  const kindsSet = new Set(kinds);

  // Cleanly reset previous videos, selections, and stale results for the scanned kinds
  let preservedCount = 0;
  let startedScanOk = false;
  await withStorageLock(async () => {
    if (isScanStopped()) return;
    const existingVideos = await storage.getVideos(cleanUsername);
    const preservedVideos = existingVideos.filter((v) => !kindsSet.has(v.kind));
    preservedCount = preservedVideos.length;
    await storage.setVideos(cleanUsername, preservedVideos);

    const existingSelection = await storage.getSelection(cleanUsername);
    const updatedSelection = new Set(
      Array.from(existingSelection).filter((key) => {
        const k = key.split(':')[0] as VideoKind;
        return !kindsSet.has(k);
      })
    );
    await storage.setSelection(cleanUsername, updatedSelection);

    const existingResults = await storage.getResults(cleanUsername);
    const updatedResults: typeof existingResults = {};
    for (const [k, rec] of Object.entries(existingResults)) {
      const kindPrefix = k.split(':')[0] as VideoKind;
      if (!kindsSet.has(kindPrefix)) {
        updatedResults[k] = rec;
      }
    }
    await storage.setResults(cleanUsername, updatedResults);

    const q = await storage.getQueue();
    if (!isActive(q) && kinds.length === 2) {
      await storage.setQueue(emptyQueue());
    }

    await storage.setScan({
      status: 'scanning',
      account: cleanUsername,
      kinds,
      currentKind: kinds[0] || null,
      found: preservedCount,
      newFound: 0,
      message: `Đang kết nối phiên TikTok @${cleanUsername}...`,
      code: null,
      startedAt: Date.now(),
      finishedAt: null,
    });
    startedScanOk = true;
  });

  if (!startedScanOk || isScanStopped()) return;

  await storage.appendLog({
    level: 'info',
    message: `Bắt đầu quét ${kinds.join(' & ')} cho @${cleanUsername}`,
    account: cleanUsername,
  });

  for (const kind of kinds) {
    if (isScanStopped()) break;
    const currentScan = await storage.getScan();
    if (currentScan.status !== 'scanning') break;

    const kindLabel = kind === 'repost' ? 'Đăng lại (Reposts)' : 'Đã thích (Likes)';
    await withStorageLock(async () => {
      if (isScanStopped()) return;
      const latest = await storage.getScan();
      if (latest.status !== 'scanning') return;
      await storage.setScan({
        ...latest,
        currentKind: kind,
        message: `Đang quét danh sách ${kindLabel}...`,
      });
    });

    const videosNow = await storage.getVideos(cleanUsername);
    const knownIds = videosNow.filter((v) => v.kind === kind).map((v) => v.videoId);

    // Ensure content script is ready on tab
    await pingTab(tab.id);
    if (isScanStopped()) break;

    let donePayload = await runSingleTabScanAttempt(tab.id, scanToken, {
      kind,
      username: cleanUsername,
      secUid: acc.secUid,
      skipApi: false,
      limit: settings.scanLimit,
      knownIds,
    });

    if (isScanStopped() || donePayload.code === 'CANCELLED') {
      break;
    }

    // If DOM fallback is needed and tab wasn't on `/@username` yet, navigate ONCE to canonical profile URL
    if (donePayload.code === 'NAVIGATING_TO_PROFILE') {
      const sCheck = await storage.getScan();
      if (isScanStopped() || sCheck.status !== 'scanning') break;

      await withStorageLock(async () => {
        if (isScanStopped()) return;
        const latest = await storage.getScan();
        if (latest.status !== 'scanning') return;
        await storage.setScan({
          ...latest,
          message: `Đang mở trang cá nhân @${cleanUsername} để kiểm tra ${kindLabel}...`,
        });
      });

      const navRes = await navigateAndWaitForProfile(tab.id, cleanUsername, 15000, isScanStopped);
      if (navRes.aborted || isScanStopped()) {
        break;
      }
      if (navRes.http403) {
        donePayload = {
          kind,
          total: 0,
          code: 'HTTP_403',
          message: 'TikTok trả về HTTP 403 khi mở trang cá nhân. Đã dừng an toàn.',
          haltRun: true,
        };
      } else if (!navRes.ok) {
        donePayload = {
          kind,
          total: 0,
          code: 'PAGE_LOAD_TIMEOUT',
          message: `Không thể tải trang cá nhân @${cleanUsername}.`,
          haltRun: true,
        };
      } else {
        const postNavScan = await storage.getScan();
        if (isScanStopped() || postNavScan.status !== 'scanning') break;
        const refreshedVideos = await storage.getVideos(cleanUsername);
        const refreshedKnownIds = refreshedVideos.filter((v) => v.kind === kind).map((v) => v.videoId);
        donePayload = await runSingleTabScanAttempt(tab.id, scanToken, {
          kind,
          username: cleanUsername,
          secUid: acc.secUid,
          skipApi: true,
          limit: settings.scanLimit,
          knownIds: refreshedKnownIds,
        });
      }
    }

    if (isScanStopped() || donePayload.code === 'CANCELLED') {
      break;
    }

    // Halt immediately on HTTP 403 / CAPTCHA / Rate Limit / Safety Stop — never overwrite with 'done'
    if (donePayload.haltRun || HALT_CODES.has(donePayload.code)) {
      const videosAfter = await storage.getVideos(cleanUsername);
      await withStorageLock(async () => {
        if (isScanStopped()) return;
        await storage.setScan({
          status: 'error',
          account: cleanUsername,
          kinds,
          currentKind: kind,
          found: videosAfter.length,
          newFound: videosAfter.length - preservedCount,
          message: donePayload.message || `Quét tạm dừng do mã bảo vệ (${donePayload.code}).`,
          code: donePayload.code,
          startedAt: curScan.startedAt || Date.now(),
          finishedAt: Date.now(),
        });
      });
      await storage.appendLog({
        level: 'error',
        message: `Quét dừng an toàn (${donePayload.code}): ${donePayload.message}`,
        account: cleanUsername,
      });
      return;
    }
  }

  if (isScanStopped()) {
    return;
  }

  await withStorageLock(async () => {
    if (isScanStopped()) return;
    const finalScan = await storage.getScan();
    if (finalScan.status !== 'scanning') return;

    const finalVideos = await storage.getVideos(cleanUsername);
    const repostCount = finalVideos.filter((v) => v.kind === 'repost').length;
    const likeCount = finalVideos.filter((v) => v.kind === 'like').length;
    let detailMsg = `Quét thành công! Đã tìm thấy ${finalVideos.length} video.`;
    if (kinds.length > 1) {
      detailMsg = `Quét thành công! (${repostCount} Reposts, ${likeCount} Likes)`;
    } else if (kinds[0] === 'repost') {
      detailMsg = `Quét thành công! Đã tìm thấy ${repostCount} video Repost.`;
    } else if (kinds[0] === 'like') {
      detailMsg = `Quét thành công! Đã tìm thấy ${likeCount} video Đã thích.`;
    }

    await storage.setScan({
      ...finalScan,
      status: 'done',
      currentKind: null,
      found: finalVideos.length,
      message: detailMsg,
      finishedAt: Date.now(),
    });
    await storage.appendLog({
      level: 'success',
      message: `Hoàn tất: ${detailMsg} cho @${cleanUsername}`,
      account: cleanUsername,
    });
  });
}

// ---------------------- MESSAGE DISPATCHER ----------------------

chrome.runtime.onMessage.addListener(
  (message: UiToBg | { type: string; [key: string]: any }, sender, sendResponse) => {
    const handle = async (): Promise<BgResponse | MainWorldSessionResult | MainWorldFetchResult> => {
      switch (message.type) {
        case 'GET_ACCOUNT': {
          const acc = await checkAccount();
          return { ok: true, data: acc };
        }

        case 'GET_PAGE_SESSION': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) {
            return { loggedIn: false, username: null, secUid: null, uid: null, http403: false };
          }
          const session = await getPageSessionFromMainWorld(tabId);
          return session || { loggedIn: false, username: null, secUid: null, uid: null, http403: false };
        }

        case 'TIKTOK_API_FETCH': {
          const tabId = sender.tab?.id;
          if (tabId === undefined) {
            return { ok: false, status: 0, data: null, networkError: 'Missing sender tabId' };
          }
          return executeMainWorldFetch(tabId, {
            pathAndQuery: String(message.pathAndQuery || ''),
            method: message.method === 'POST' ? 'POST' : 'GET',
            body: typeof message.body === 'string' ? message.body : undefined,
            headers: message.headers,
            timeoutMs: typeof message.timeoutMs === 'number' ? message.timeoutMs : 20000,
          });
        }

        case 'CONTENT_READY': {
          if (sender.tab?.id !== undefined) {
            checkAccount(sender.tab.id).catch(() => {});
          }
          return { ok: true };
        }

        case 'OPEN_TIKTOK': {
          await ensureTikTokTab();
          return { ok: true };
        }

        case 'OPEN_DASHBOARD': {
          const url = chrome.runtime.getURL('dashboard.html');
          const tabs = await chrome.tabs.query({ url });
          if (tabs.length > 0 && tabs[0].id !== undefined) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
          } else {
            await chrome.tabs.create({ url, active: true });
          }
          return { ok: true };
        }

        case 'START_SCAN': {
          scanStopRequested = false;
          const scanToken = ++activeScanRunToken;
          startScanFlow(message.kinds, scanToken).catch(() => {});
          return { ok: true };
        }

        case 'STOP_SCAN': {
          // Immediately flip in-memory stop flags & broadcast to all TikTok tabs
          scanStopRequested = true;
          activeScanRunToken += 1;
          broadcastToTikTokTabs({ type: 'SCAN_STOP' }, activeScanTabId).catch(() => {});

          await withStorageLock(async () => {
            const s = await storage.getScan();
            await storage.setScan({
              ...s,
              status: 'stopped',
              currentKind: null,
              message: 'Đã dừng quét; các video thu thập được đã được giữ lại.',
              finishedAt: Date.now(),
            });
          });
          await storage.appendLog({
            level: 'warn',
            message: 'Đã dừng quét theo yêu cầu người dùng.',
          });
          return { ok: true };
        }

        case 'START_CLEANUP': {
          const curScan = await storage.getScan();
          if (curScan.status === 'scanning') {
            return { ok: false, error: 'Vui lòng dừng hoặc đợi quá trình quét hoàn tất trước khi dọn dẹp.' };
          }

          const curQueue = await storage.getQueue();
          if (isActive(curQueue)) {
            return { ok: false, error: 'Hàng đợi dọn dẹp đang chạy.' };
          }

          const acc = await checkAccount();
          if (!acc || !acc.loggedIn || !acc.username) {
            return { ok: false, error: 'Vui lòng đăng nhập TikTok trước khi dọn dẹp.' };
          }
          const username = acc.username;

          let q = emptyQueue();
          await withStorageLock(async () => {
            const allVideos = await storage.getVideos(username);
            const existingResults = await storage.getResults(username);
            const selKeys = new Set(message.keys as string[]);

            // Deduplicate and filter out already-cleaned / unavailable items
            const eligibleVideos = allVideos.filter(
              (v) => selKeys.has(v.key) && isEligible(v, existingResults)
            );

            // Reset prior failed status for items being retried in this run
            let modifiedResults = false;
            for (const v of eligibleVideos) {
              if (existingResults[v.key]?.status === 'failed') {
                delete existingResults[v.key];
                modifiedResults = true;
              }
            }
            if (modifiedResults) {
              await storage.setResults(username, existingResults);
            }

            const settings = await storage.getSettings();
            const runId = uid('run_');
            q = createQueue(eligibleVideos, username, settings.maxItemsPerRun, runId, Date.now());
            await storage.setQueue(q);
          });

          if (q.jobs.length === 0) {
            await storage.setQueue(emptyQueue());
            return { ok: false, error: 'Không có video hợp lệ nào cần dọn dẹp trong lựa chọn.' };
          }

          queueStopRequested = false;
          queuePauseRequested = false;
          const runToken = ++activeQueueRunToken;

          await storage.appendLog({
            level: 'info',
            message: `Bắt đầu dọn dẹp tuần tự ${q.jobs.length} video cho @${username}`,
            account: username,
          });

          runQueueLoop(runToken).catch(() => {});
          return { ok: true, data: q };
        }

        case 'PAUSE': {
          queuePauseRequested = true;
          let updatedQueue = emptyQueue();
          await withStorageLock(async () => {
            let q = await storage.getQueue();
            broadcastToTikTokTabs({ type: 'ACTION_STOP' }, q.workerTabId).catch(() => {});
            q = requestPause(q);
            // If loop isn't mid-click, transition straight to 'paused' so UI reflects pause immediately
            if (!isLoopRunning && q.status === 'pausing') {
              q = settlePause(q);
            }
            updatedQueue = q;
            await storage.setQueue(q);
          });
          await storage.appendLog({ level: 'info', message: 'Đã yêu cầu tạm dừng dọn dẹp.' });
          return { ok: true, data: updatedQueue };
        }

        case 'RESUME': {
          const curScan = await storage.getScan();
          if (curScan.status === 'scanning') {
            return { ok: false, error: 'Đang quét dữ liệu, chưa thể tiếp tục dọn dẹp.' };
          }
          let resumedQueue: ReturnType<typeof resume> | null = null;
          await withStorageLock(async () => {
            const q = await storage.getQueue();
            if (canResume(q)) {
              resumedQueue = resume(q);
              await storage.setQueue(resumedQueue);
            }
          });
          if (resumedQueue) {
            queueStopRequested = false;
            queuePauseRequested = false;
            const runToken = ++activeQueueRunToken;
            await storage.appendLog({ level: 'info', message: 'Tiếp tục hàng đợi dọn dẹp từ tiến độ đã lưu.' });
            runQueueLoop(runToken).catch(() => {});
            return { ok: true, data: resumedQueue };
          }
          return { ok: false, error: 'Không có hàng đợi tạm dừng nào để tiếp tục.' };
        }

        case 'STOP': {
          queueStopRequested = true;
          queuePauseRequested = false;
          activeQueueRunToken += 1;

          let stoppedQueue = emptyQueue();
          await withStorageLock(async () => {
            let q = await storage.getQueue();
            broadcastToTikTokTabs({ type: 'ACTION_STOP' }, q.workerTabId).catch(() => {});
            q = stop(q, Date.now(), 'Đã dừng theo yêu cầu người dùng (tiến độ được giữ nguyên)');
            stoppedQueue = q;
            await storage.setQueue(q);
          });
          await storage.appendLog({ level: 'warn', message: 'Đã dừng dọn dẹp; tiến độ đã lưu để có thể tiếp tục.' });
          return { ok: true, data: stoppedQueue };
        }

        case 'RESET_PROGRESS': {
          const q = await storage.getQueue();
          if (isActive(q)) {
            return { ok: false, error: 'Không thể đặt lại khi hàng đợi đang chạy.' };
          }
          await withStorageLock(async () => {
            await storage.setQueue(emptyQueue());
          });
          return { ok: true };
        }

        case 'RESET_SESSION': {
          scanStopRequested = true;
          activeScanRunToken += 1;
          queueStopRequested = true;
          queuePauseRequested = false;
          activeQueueRunToken += 1;
          broadcastToTikTokTabs({ type: 'SCAN_STOP' }, activeScanTabId).catch(() => {});
          broadcastToTikTokTabs({ type: 'ACTION_STOP' }).catch(() => {});

          await withStorageLock(async () => {
            const acc = await storage.getAccount();
            if (acc?.username) {
              await storage.setVideos(acc.username, []);
              await storage.setSelection(acc.username, new Set());
              await storage.setResults(acc.username, {});
            }
            await storage.setQueue(emptyQueue());
            await storage.setScan(emptyScan());
          });
          await storage.appendLog({
            level: 'info',
            message: 'Đã đặt lại toàn bộ danh sách và thống kê về 0.',
          });
          return { ok: true };
        }

        case 'CLEAR_CACHE': {
          scanStopRequested = true;
          activeScanRunToken += 1;
          queueStopRequested = true;
          queuePauseRequested = false;
          activeQueueRunToken += 1;
          broadcastToTikTokTabs({ type: 'SCAN_STOP' }, activeScanTabId).catch(() => {});
          broadcastToTikTokTabs({ type: 'ACTION_STOP' }).catch(() => {});
          await withStorageLock(async () => {
            await storage.clearAll();
          });
          return { ok: true };
        }

        case 'SCAN_BATCH': {
          return withStorageLock(async () => {
            if (scanStopRequested) return { ok: true };
            const { kind, items } = message;
            const scan = await storage.getScan();
            if (scan.status !== 'scanning') return { ok: true };

            const username = scan.account || (await storage.getAccount())?.username;
            if (!username) return { ok: false };

            const currentVideos = await storage.getVideos(username);
            const videoMap = new Map<string, ScannedVideo>();
            let nextScanIndex = 0;
            for (const v of currentVideos) {
              videoMap.set(v.key, v);
              if (v.scanIndex >= nextScanIndex) {
                nextScanIndex = v.scanIndex + 1;
              }
            }

            const now = Date.now();
            let addedCount = 0;

            for (const item of items) {
              const key = videoKey(kind, item.videoId);
              const existing = videoMap.get(key);
              if (!existing) {
                const scannedVideo: ScannedVideo = {
                  ...item,
                  key,
                  scanIndex: nextScanIndex++,
                  scannedAt: now,
                };
                videoMap.set(key, scannedVideo);
                addedCount++;
              } else {
                let modified = false;
                if (!existing.thumbnail && item.thumbnail) {
                  existing.thumbnail = item.thumbnail;
                  modified = true;
                }
                if (!existing.description && item.description) {
                  existing.description = item.description;
                  modified = true;
                }
                if (existing.views === null && item.views !== null) {
                  existing.views = item.views;
                  existing.viewsText = item.viewsText;
                  modified = true;
                }
                if (!existing.scanPage && item.scanPage) {
                  existing.scanPage = item.scanPage;
                  modified = true;
                }
                if (modified) {
                  videoMap.set(key, { ...existing });
                }
              }
            }

            if (scanStopRequested) return { ok: true };
            const latestScan = await storage.getScan();
            if (latestScan.status !== 'scanning') return { ok: true };

            const updatedVideos = Array.from(videoMap.values());
            await storage.setVideos(username, updatedVideos);
            await storage.setScan({
              ...latestScan,
              found: updatedVideos.length,
              newFound: (latestScan.newFound || 0) + addedCount,
            });

            return { ok: true };
          });
        }

        case 'SCAN_PROGRESS': {
          return withStorageLock(async () => {
            if (scanStopRequested) return { ok: true };
            const scan = await storage.getScan();
            if (scan.status !== 'scanning') return { ok: true };
            const username = scan.account;
            const totalVideos = username ? (await storage.getVideos(username)).length : message.found;
            if (scanStopRequested) return { ok: true };
            const latestScan = await storage.getScan();
            if (latestScan.status !== 'scanning') return { ok: true };
            await storage.setScan({
              ...latestScan,
              found: Math.max(totalVideos, message.found || 0),
              message: message.message || latestScan.message,
            });
            return { ok: true };
          });
        }

        case 'SCAN_DONE': {
          return { ok: true };
        }

        default:
          return { ok: false, error: 'Unknown message type' };
      }
    };

    handle().then(sendResponse);
    return true;
  }
);
