// Shared domain types used by background, content scripts and UI.

export type VideoKind = 'repost' | 'like';
export type MediaType = 'video' | 'photo';

export interface ScannedVideo {
  /** Unique key: `${kind}:${videoId}` — the same video can be both reposted and liked. */
  key: string;
  videoId: string;
  kind: VideoKind;
  mediaType: MediaType;
  url: string;
  author: string;
  description: string;
  thumbnail: string | null;
  /** Raw view-count text as shown by TikTok (e.g. "12.3K"), if present. */
  viewsText: string | null;
  /** Parsed numeric views, if parsable. */
  views: number | null;
  /** True if the video was deleted or set to private by its creator */
  isUnavailable?: boolean;
  /** Verified TikTok source order (0 = newest item in feed, increasing towards oldest). */
  scanIndex: number;
  scannedAt: number;
  /** Verified post publish Unix timestamp (seconds) from TikTok API if provided; null otherwise. */
  createTime?: number | null;
  /** Original API pagination page index (used for bounded server verification). */
  scanPage?: number;
}

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'unverified'
  | 'skipped'
  | 'unavailable';
export type ActionType = 'remove_repost' | 'remove_like';

export type LikeFlowStage =
  | 'OPENING'
  | 'WAITING_FOR_VIDEO'
  | 'WAITING_FOR_LIKE_BUTTON'
  | 'CHECKING_LIKE'
  | 'UNLIKING'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'UNVERIFIED'
  | 'SKIPPED';

export interface Job {
  key: string;
  videoId: string;
  accountId: string;
  url: string;
  action: ActionType;
  attempts: number;
  status: JobStatus;
  error: string | null;
  errorCode: string | null;
  processedAt: number | null;
}

export type RunStatus = 'idle' | 'running' | 'pausing' | 'paused' | 'stopped' | 'completed';

export interface QueueState {
  runId: string | null;
  account: string | null;
  status: RunStatus;
  /** Machine readable reason for the last pause/stop (CAPTCHA, TAB_CLOSED, …). */
  reasonCode: string | null;
  reason: string | null;
  jobs: Job[];
  createdAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  consecutiveErrors: number;
  workerTabId: number | null;
  /** Rolling window of recent click verifications (true = verified, false = failed). */
  verifyHistory?: boolean[];
  verifyStreak?: number;
  verifyFailsTotal?: number;
  /** Rolling window of recent like-state determinacy reads (true = readable, false = null). */
  detHistory?: boolean[];
  detStreak?: number;
}

export interface ResultRecord {
  status: JobStatus;
  error: string | null;
  processedAt: number | null;
}

export type ScanStatus = 'idle' | 'scanning' | 'done' | 'error' | 'stopped';

export interface ScanState {
  status: ScanStatus;
  account: string | null;
  kinds: VideoKind[];
  currentKind: VideoKind | null;
  found: number;
  newFound: number;
  message: string | null;
  code: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface AccountInfo {
  loggedIn: boolean;
  username: string | null;
  secUid?: string | null;
  /** Where the information came from (for transparency). */
  source: 'main' | 'nav' | 'profile' | 'none';
  checkedAt: number;
  tabId: number | null;
}

export type Lang = 'en' | 'vi';
export type Theme = 'dark' | 'light';

export interface Settings {
  language: Lang;
  theme: Theme;
  /** Seconds to wait between two cleanup actions. */
  actionDelay: number;
  maxItemsPerRun: number;
  retryLimit: number;
  stopOnConsecutiveErrors: number;
  /** Always true — exposed in Settings as a locked safety option. */
  confirmBeforeCleanup: true;
  /** Max videos to collect per scan per category. */
  scanLimit: number;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  message: string;
  videoId?: string;
  action?: ActionType;
  account?: string | null;
}

export interface HistoryEntry {
  runId: string;
  account: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  success: number;
  failed: number;
  unverified?: number;
  skipped: number;
  unavailable: number;
  endStatus: RunStatus;
  reason: string | null;
}

/** Result returned by the content script after attempting one job. */
export interface ActionResult {
  status: 'success' | 'skipped' | 'failed' | 'unverified' | 'unavailable';
  code: string;
  message: string;
  /** If true the whole run must pause (CAPTCHA, rate limit, logged out, account switch). */
  haltRun?: boolean;
  /** Terminal stage in the explicit processing state machine. */
  stage?: LikeFlowStage;
  /** Explicit verified reason whenever status === 'skipped'. */
  skipReason?: string;
  /** Ordered sequence of state-machine stages traversed during execution. */
  trace?: LikeFlowStage[];
}
