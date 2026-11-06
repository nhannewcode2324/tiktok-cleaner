import type { AccountInfo, ActionResult, ActionType, ScannedVideo, VideoKind } from './types';

// ---- UI -> Background ----
export type UiToBg =
  | { type: 'GET_ACCOUNT'; refresh?: boolean }
  | { type: 'OPEN_TIKTOK' }
  | { type: 'START_SCAN'; kinds: VideoKind[] }
  | { type: 'STOP_SCAN' }
  | { type: 'START_CLEANUP'; keys: string[]; confirmed: true }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'RESET_PROGRESS'; confirmed: true }
  | { type: 'CLEAR_CACHE'; confirmed: true }
  | { type: 'OPEN_DASHBOARD' };

// ---- Background -> Content ----
export type BgToContent =
  | { type: 'PING' }
  | { type: 'DETECT_ACCOUNT' }
  | { type: 'SCAN'; kind: VideoKind; username: string; limit: number; knownIds: string[]; secUid?: string | null; skipApi?: boolean }
  | { type: 'START_SCAN_TAB'; kind: VideoKind; username: string; secUid?: string | null; skipApi?: boolean; limit: number; knownIds: string[] }
  | { type: 'SCAN_STOP' }
  | { type: 'ACTION_STOP' }
  | {
      type: 'PERFORM';
      action: ActionType;
      videoId: string;
      account: string;
      url?: string;
      directVideoPage?: boolean;
    }
  | { type: 'VERIFY_REPOSTS'; secUid: string; pageLimit: number };

// ---- Content -> Background ----
export type ContentToBg =
  | { type: 'CONTENT_READY'; url: string }
  | { type: 'GET_PAGE_SESSION' }
  | {
      type: 'TIKTOK_API_FETCH';
      pathAndQuery: string;
      method?: 'GET' | 'POST';
      body?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }
  | { type: 'SCAN_BATCH'; kind: VideoKind; items: Omit<ScannedVideo, 'key' | 'scanIndex' | 'scannedAt'>[] }
  | { type: 'SCAN_PROGRESS'; kind: VideoKind; found: number; message?: string }
  | { type: 'SCAN_DONE'; kind: VideoKind; total: number; code: string; message: string; haltRun?: boolean };

export interface MainWorldSessionResult {
  loggedIn: boolean;
  username: string | null;
  secUid: string | null;
  uid: string | null;
  http403: boolean;
}

export interface MainWorldFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  networkError?: string;
  timedOut?: boolean;
}

export interface PingResponse {
  ok: true;
  url: string;
  account: AccountInfo;
  captcha: boolean;
  http403?: boolean;
}

export interface ScanResponse {
  ok: boolean;
  code: string;
  message: string;
  total: number;
}

export type PerformResponse = ActionResult;

export interface BgResponse<T = unknown> {
  ok: boolean;
  error?: string;
  code?: string;
  data?: T;
}
