import type { MainWorldFetchResult, MainWorldSessionResult } from '../shared/messages';
import type { MediaType, ScannedVideo, VideoKind } from '../shared/types';
import { detectCaptcha, detectHttp403 } from './dom-observer';
import { getActionAbortSignal, getScanAbortSignal, sleepWithAbort } from './abort-signal';

export class UserAbortError extends Error {
  constructor(message = 'Đã dừng theo yêu cầu người dùng.') {
    super(message);
    this.name = 'UserAbortError';
  }
}

export interface TikTokApiItem {
  id?: string;
  desc?: string;
  createTime?: number;
  privateItem?: boolean;
  secret?: boolean;
  takeDown?: number;
  author?: {
    uniqueId?: string;
    secUid?: string;
  };
  video?: {
    cover?: string;
    originCover?: string;
    dynamicCover?: string;
    playAddr?: string;
  };
  imagePost?: {
    images?: Array<{
      imageURL?: {
        urlList?: string[];
      };
    }>;
  };
  stats?: {
    playCount?: number;
  };
  status?: {
    isPrivate?: boolean;
    isDelete?: boolean;
    privateStatus?: number;
  };
}

export interface TikTokListResponse {
  status_code?: number;
  statusCode?: number;
  status_msg?: string;
  statusMsg?: string;
  itemList?: TikTokApiItem[];
  hasMore?: boolean;
  cursor?: string | number;
}

export interface TikTokActionResponse {
  status_code?: number;
  statusCode?: number;
  status_msg?: string;
  statusMsg?: string;
}

export class SafetyStopError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SafetyStopError';
  }
}

export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message?: string
  ) {
    super(message || `TikTok request failed (${status}).`);
    this.name = 'HttpError';
  }
}

const SAFETY_MESSAGE =
  /captcha|verify|verification|too many|too frequent|rate.?limit|risk|restricted|unusual|slow down|thao tác quá nhanh|quá nhiều lần|xác minh/i;

const REQUEST_TIMEOUT_MS = 20_000;
const REQUESTED_PAGE_SIZE = 50;
const FALLBACK_PAGE_SIZE = 30;

let repostPageSize = REQUESTED_PAGE_SIZE;

export function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export async function waitWhile(ms: number, shouldContinue: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  while (shouldContinue() && Date.now() < end) {
    const step = Math.min(250, end - Date.now());
    if (step > 0) {
      await new Promise((resolve) => setTimeout(resolve, step));
    }
  }
  return shouldContinue();
}

function formatCompactCount(count: number | undefined | null): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

async function executeTikTokFetch(
  pathAndQuery: string,
  method: 'GET' | 'POST' = 'GET',
  body?: string,
  headers?: Record<string, string>,
  abortSignal?: AbortSignal
): Promise<MainWorldFetchResult> {
  if (abortSignal?.aborted) {
    throw new UserAbortError();
  }

  const raceWithAbort = <R>(promise: Promise<R>): Promise<R> => {
    if (!abortSignal) return promise;
    if (abortSignal.aborted) return Promise.reject(new UserAbortError());
    return new Promise<R>((resolve, reject) => {
      const onAbort = () => reject(new UserAbortError());
      abortSignal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (val) => {
          abortSignal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        (err) => {
          abortSignal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  };

  try {
    const res = (await raceWithAbort(
      chrome.runtime.sendMessage({
        type: 'TIKTOK_API_FETCH',
        pathAndQuery,
        method,
        body,
        headers,
        timeoutMs: REQUEST_TIMEOUT_MS,
      })
    )) as MainWorldFetchResult | undefined;

    if (res && typeof res.status === 'number') {
      return res;
    }
  } catch (err) {
    if (err instanceof UserAbortError) throw err;
    // Fallback to direct fetch in current context if message channel unavailable
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  abortSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const url = pathAndQuery.startsWith('http')
      ? pathAndQuery
      : `${window.location.origin}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
    const response = await fetch(url, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: controller.signal,
    });
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
    if (abortSignal?.aborted) {
      throw new UserAbortError();
    }
    const timedOut = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      timedOut,
      networkError: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function requestTikTokJson<T>(
  pathAndQuery: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: string;
    headers?: Record<string, string>;
    retries?: number;
    signal?: AbortSignal;
  }
): Promise<T> {
  const method = options?.method ?? 'GET';
  const retries = method === 'GET' ? (options?.retries ?? 2) : 0; // Never replay POST delete requests
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options?.signal?.aborted) {
      throw new UserAbortError();
    }
    if (detectHttp403(document)) {
      throw new SafetyStopError(
        'HTTP_403',
        'TikTok từ chối truy cập (HTTP 403). Đã dừng an toàn và lưu tiến độ.'
      );
    }
    if (detectCaptcha(document)) {
      throw new SafetyStopError(
        'CAPTCHA',
        'Phát hiện xác minh CAPTCHA trên TikTok. Vui lòng hoàn tất xác minh trước khi tiếp tục.'
      );
    }

    const res = await executeTikTokFetch(
      pathAndQuery,
      method,
      options?.body,
      options?.headers,
      options?.signal
    );

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      const code = res.status === 403 ? 'HTTP_403' : res.status === 429 ? 'RATE_LIMIT' : 'HTTP_401';
      throw new SafetyStopError(
        code,
        `TikTok trả về mã ${res.status}. Đã dừng ngay để bảo vệ tài khoản và lưu toàn bộ tiến độ.`
      );
    }

    try {
      if (res.timedOut) {
        throw new TransientError('Yêu cầu tới TikTok quá thời gian chờ (20 giây).');
      }
      if (res.networkError) {
        throw new TransientError(`Lỗi mạng khi kết nối TikTok: ${res.networkError}`);
      }
      if (res.status >= 500) {
        throw new TransientError(`Máy chủ TikTok tạm thời bận (${res.status}).`);
      }
      if (!res.ok) {
        throw new HttpError(res.status);
      }
      if (res.data === null || typeof res.data !== 'object') {
        throw new Error('EMPTY_JSON_BODY');
      }
      return res.data as T;
    } catch (error) {
      if (error instanceof UserAbortError || options?.signal?.aborted) {
        throw new UserAbortError();
      }
      lastError = error;
      const isTransient = error instanceof TransientError;
      if (error instanceof SafetyStopError || !isTransient || attempt === retries) {
        throw lastError;
      }
      const delayMs = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export function assertTikTokSuccess(result: TikTokActionResponse, actionLabel: string): void {
  const code = result.status_code ?? result.statusCode ?? 0;
  if (code === 0) return;
  const msg = result.status_msg || result.statusMsg || `TikTok không thể ${actionLabel} (mã ${code}).`;
  if (SAFETY_MESSAGE.test(msg)) {
    throw new SafetyStopError('SAFETY_STOP', `${msg} — Đã dừng an toàn để bảo vệ tài khoản.`);
  }
  throw new Error(msg);
}

export async function fetchPageSession(): Promise<MainWorldSessionResult> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'GET_PAGE_SESSION',
    })) as MainWorldSessionResult | undefined;
    if (res) return res;
  } catch {
    /* ignore */
  }
  return {
    loggedIn: false,
    username: null,
    secUid: null,
    uid: null,
    http403: detectHttp403(document),
  };
}

export type ScannedBatchItem = Omit<ScannedVideo, 'key' | 'scanIndex' | 'scannedAt'>;

function mapApiItemToVideo(
  item: TikTokApiItem,
  kind: VideoKind,
  loggedInUsername: string,
  scanPage: number
): ScannedBatchItem | null {
  if (!item.id) return null;
  const author = (item.author?.uniqueId || '').trim();
  const cleanUser = loggedInUsername.replace(/^@/, '').toLowerCase().trim();
  const cleanAuthor = author.replace(/^@/, '').toLowerCase().trim();

  // Exclude user's own original posts and own private videos
  if (cleanUser && cleanAuthor && cleanAuthor === cleanUser) {
    return null;
  }
  if ((item.privateItem || item.secret) && cleanAuthor === cleanUser) {
    return null;
  }

  const mediaType: MediaType = item.imagePost ? 'photo' : 'video';
  const thumbnail =
    item.video?.cover ||
    item.video?.originCover ||
    item.video?.dynamicCover ||
    item.imagePost?.images?.[0]?.imageURL?.urlList?.[0] ||
    null;

  const isUnavailable = Boolean(
    item.status?.isDelete ||
      item.status?.isPrivate ||
      (typeof item.takeDown === 'number' && item.takeDown > 0) ||
      (!thumbnail && !item.video?.playAddr && !item.imagePost)
  );

  const safeAuthor = author || 'unknown';
  const playCount = item.stats?.playCount ?? null;
  const createTime =
    typeof item.createTime === 'number' && Number.isFinite(item.createTime) && item.createTime > 0
      ? item.createTime
      : null;

  return {
    videoId: String(item.id),
    kind,
    mediaType,
    url: `https://www.tiktok.com/@${safeAuthor}/${mediaType}/${item.id}`,
    author: safeAuthor,
    description: (item.desc || '').trim().slice(0, 300),
    thumbnail,
    views: typeof playCount === 'number' ? playCount : null,
    viewsText: formatCompactCount(playCount),
    isUnavailable,
    createTime,
    scanPage,
  };
}

export interface ApiPageResult {
  items: ScannedBatchItem[];
  returned: number;
  hasMore: boolean;
  cursor: string;
}

export async function listApiPage(
  kind: VideoKind,
  secUid: string,
  loggedInUsername: string,
  cursor: string,
  scanPage: number,
  signal?: AbortSignal
): Promise<ApiPageResult> {
  if (kind === 'repost') {
    const requestRepostPage = (count: number) => {
      const params = new URLSearchParams({
        aid: '1988',
        count: String(count),
        coverFormat: '2',
        cursor,
        needPinnedItemIds: 'true',
        post_item_list_request_type: '0',
        secUid,
      });
      return requestTikTokJson<TikTokListResponse>(`/api/repost/item_list/?${params.toString()}`, {
        method: 'GET',
        retries: 2,
        signal,
      });
    };

    let result: TikTokListResponse;
    try {
      result = await requestRepostPage(repostPageSize);
    } catch (err) {
      if (err instanceof HttpError && err.status === 400 && repostPageSize === REQUESTED_PAGE_SIZE) {
        repostPageSize = FALLBACK_PAGE_SIZE;
        result = await requestRepostPage(repostPageSize);
      } else {
        throw err;
      }
    }

    assertTikTokSuccess(result, 'tải danh sách Repost');
    const rawItems = Array.isArray(result.itemList) ? result.itemList : [];
    const items = rawItems
      .map((it) => mapApiItemToVideo(it, 'repost', loggedInUsername, scanPage))
      .filter((it): it is ScannedBatchItem => it !== null);
    const nextCursor = result.cursor == null ? cursor : String(result.cursor);

    return {
      items,
      returned: rawItems.length,
      hasMore: Boolean(result.hasMore),
      cursor: nextCursor,
    };
  }

  // kind === 'like'
  const params = new URLSearchParams({
    aid: '1988',
    count: '30',
    coverFormat: '2',
    cursor,
    secUid,
  });
  const result = await requestTikTokJson<TikTokListResponse>(`/api/favorite/item_list/?${params.toString()}`, {
    method: 'GET',
    retries: 2,
    signal,
  });

  assertTikTokSuccess(result, 'tải danh sách Đã thích');
  const rawItems = Array.isArray(result.itemList) ? result.itemList : [];
  const items = rawItems
    .map((it) => mapApiItemToVideo(it, 'like', loggedInUsername, scanPage))
    .filter((it): it is ScannedBatchItem => it !== null);
  const nextCursor = result.cursor == null ? cursor : String(result.cursor);

  return {
    items,
    returned: rawItems.length,
    hasMore: Boolean(result.hasMore),
    cursor: nextCursor,
  };
}

export interface ApiScanSummary {
  ok: boolean;
  code: string;
  message: string;
  total: number;
  pagesScanned: number;
  fallbackToDom?: boolean;
  haltRun?: boolean;
}

export async function scanKindViaApi(
  kind: VideoKind,
  secUid: string,
  username: string,
  limit: number,
  knownIds: string[],
  isAborted: () => boolean
): Promise<ApiScanSummary> {
  const seenIds = new Set<string>(knownIds);
  const visitedCursors = new Set<string>();
  let cursor = '0';
  let pagesScanned = 0;
  let totalFound = 0;
  const kindLabel = kind === 'repost' ? 'Repost' : 'Đã thích';
  const scanSignal = getScanAbortSignal();

  while (!isAborted() && !scanSignal.aborted && totalFound < limit) {
    if (visitedCursors.has(cursor)) {
      break; // Repeated cursor guard (from tiktokRepostRemover) -> prevents infinite loop
    }
    visitedCursors.add(cursor);

    let page: ApiPageResult;
    try {
      page = await listApiPage(kind, secUid, username, cursor, pagesScanned + 1, scanSignal);
    } catch (err) {
      if (err instanceof UserAbortError || isAborted() || scanSignal.aborted) {
        break;
      }
      if (err instanceof SafetyStopError) {
        return {
          ok: false,
          code: err.code,
          message: err.message,
          total: totalFound,
          pagesScanned,
          haltRun: true,
        };
      }
      // If the very first page fails with empty JSON or structural change, allow seamless DOM fallback
      if (pagesScanned === 0) {
        return {
          ok: false,
          code: 'API_FALLBACK_DOM',
          message: err instanceof Error ? err.message : String(err),
          total: 0,
          pagesScanned: 0,
          fallbackToDom: true,
        };
      }
      // Mid-scan non-safety error: preserve partial scan cleanly
      return {
        ok: true,
        code: 'PARTIAL_SAVED',
        message: `Đã lưu ${totalFound} video ${kindLabel} (${pagesScanned} trang) trước khi kết nối gián đoạn.`,
        total: totalFound,
        pagesScanned,
      };
    }

    // Check abort immediately after network await so no stale SCAN_BATCH / SCAN_PROGRESS is sent
    if (isAborted() || scanSignal.aborted) {
      break;
    }

    pagesScanned += 1;
    const newItems = page.items.filter((it) => !seenIds.has(it.videoId));
    if (newItems.length > 0) {
      const remainingQuota = Math.max(0, limit - totalFound);
      const batch = newItems.slice(0, remainingQuota);
      for (const it of batch) {
        seenIds.add(it.videoId);
      }
      totalFound += batch.length;

      await chrome.runtime
        .sendMessage({
          type: 'SCAN_BATCH',
          kind,
          items: batch,
        })
        .catch(() => {});
    }

    if (isAborted() || scanSignal.aborted) {
      break;
    }

    await chrome.runtime
      .sendMessage({
        type: 'SCAN_PROGRESS',
        kind,
        found: totalFound,
        message: page.hasMore
          ? `Đang quét ${kindLabel}: ${totalFound} video (trang ${pagesScanned})...`
          : `Đã quét hết ${kindLabel}: ${totalFound} video (${pagesScanned} trang).`,
      })
      .catch(() => {});

    // End-of-list conditions (from tiktokRepostRemover):
    if (!page.hasMore) {
      break;
    }
    if (totalFound >= limit) {
      break;
    }
    if (!page.cursor || page.cursor === cursor || page.cursor === '0' || page.cursor === '-1') {
      break;
    }
    if (page.returned === 0) {
      break;
    }

    cursor = page.cursor;

    // Paced randomized cooldown between pages; exits in 0ms if user clicks Stop Scan
    const cooldownMs = randomBetween(1800, 3500);
    const keepGoing =
      !isAborted() && !scanSignal.aborted && (await sleepWithAbort(cooldownMs, scanSignal)) && !isAborted();
    if (!keepGoing) break;
  }

  if (isAborted() || scanSignal.aborted) {
    return {
      ok: true,
      code: 'CANCELLED',
      message: `Đã dừng quét; đã lưu ${totalFound} video ${kindLabel}.`,
      total: totalFound,
      pagesScanned,
    };
  }

  // For Likes, if the API returned 0 items (e.g. private liked-list signature requirement),
  // verify via the in-page Liked tab DOM so private Likes are never missed.
  if (kind === 'like' && totalFound === 0) {
    return {
      ok: false,
      code: 'API_LIKE_EMPTY_VERIFY_DOM',
      message: 'Đang kiểm tra danh sách Đã thích trên giao diện...',
      total: 0,
      pagesScanned,
      fallbackToDom: true,
    };
  }

  return {
    ok: true,
    code: totalFound === 0 ? 'EMPTY' : totalFound >= limit ? 'LIMIT_REACHED' : 'COMPLETED',
    message:
      totalFound === 0
        ? `Không có video ${kindLabel} nào.`
        : `Quét thành công! Đã tìm thấy ${totalFound} video ${kindLabel} (${pagesScanned} trang).`,
    total: totalFound,
    pagesScanned,
  };
}

export async function deleteRepostViaApi(videoId: string): Promise<void> {
  const actionSignal = getActionAbortSignal();
  if (actionSignal.aborted) {
    throw new UserAbortError();
  }
  const params = new URLSearchParams({
    aid: '1988',
    item_id: videoId,
  });
  const result = await requestTikTokJson<TikTokActionResponse>(
    `/tiktok/v1/upvote/delete?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
      retries: 0,
      signal: actionSignal,
    }
  );
  assertTikTokSuccess(result, 'xóa đăng lại');
}

export async function verifyRepostsViaApi(
  secUid: string,
  username: string,
  pageLimit: number,
  isAborted?: () => boolean
): Promise<{ ok: boolean; presentIds: string[] }> {
  const presentIds: string[] = [];
  const visited = new Set<string>();
  let cursor = '0';
  let page = 0;
  const maxPages = Math.max(1, Math.min(pageLimit, 50));
  const actionSignal = getActionAbortSignal();
  const checkAborted = () => Boolean(isAborted?.() || actionSignal.aborted);

  while (page < maxPages && !checkAborted()) {
    if (visited.has(cursor)) break;
    visited.add(cursor);

    let res: ApiPageResult;
    try {
      res = await listApiPage('repost', secUid, username, cursor, page + 1, actionSignal);
    } catch (err) {
      if (err instanceof UserAbortError || checkAborted()) {
        return { ok: false, presentIds };
      }
      throw err;
    }
    page += 1;
    for (const it of res.items) {
      presentIds.push(it.videoId);
    }

    if (!res.hasMore || page >= maxPages || !res.cursor || res.cursor === cursor) {
      break;
    }
    cursor = res.cursor;
    const cont = await waitWhile(randomBetween(1800, 3200), () => !checkAborted());
    if (!cont) break;
  }

  return { ok: !checkAborted(), presentIds };
}
