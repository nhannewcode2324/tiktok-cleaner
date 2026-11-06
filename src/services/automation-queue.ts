import type { ActionResult, ActionType, Job, QueueState, ScannedVideo } from '../shared/types';
import { HALT_CODES } from '../shared/constants';

/**
 * Automation Queue — pure state machine. The background service worker owns the
 * single instance, persists it after every transition, and executes one job at a time.
 */

const NO_AUTO_RETRY_CODES = new Set([
  'VERIFY_FAILED',
  'VERIFY_INDETERMINATE',
  'INDETERMINATE_LIKE_STATE',
  'INDETERMINATE_BEFORE_CLICK',
  'VIDEO_ID_MISMATCH',
]);

const TRACKER_WINDOW_SIZE = 10;
const VERIFY_FAIL_STREAK_LIMIT = 2;
const VERIFY_FAIL_WINDOW_LIMIT = 3;
const VERIFY_FAIL_TOTAL_CEILING = 10;
const DET_FAIL_STREAK_LIMIT = 4;
const DET_FAIL_WINDOW_LIMIT = 6;

export function emptyQueue(): QueueState {
  return {
    runId: null,
    account: null,
    status: 'idle',
    reasonCode: null,
    reason: null,
    jobs: [],
    createdAt: null,
    startedAt: null,
    finishedAt: null,
    consecutiveErrors: 0,
    workerTabId: null,
    verifyHistory: [],
    verifyStreak: 0,
    verifyFailsTotal: 0,
    detHistory: [],
    detStreak: 0,
  };
}

export function actionFor(kind: ScannedVideo['kind']): ActionType {
  return kind === 'repost' ? 'remove_repost' : 'remove_like';
}

export function isActive(q: QueueState): boolean {
  return q.status === 'running' || q.status === 'pausing';
}

/**
 * Freeze the confirmed selection into an explicit list of jobs.
 * Duplicates (same key) are dropped; at most `maxItems` jobs are created.
 */
export function createQueue(
  videos: ScannedVideo[],
  account: string,
  maxItems: number,
  runId: string,
  now: number,
): QueueState {
  const seen = new Set<string>();
  const jobs: Job[] = [];

  // Group videos: all reposts first, then all likes (prevents toggling between tabs)
  const sortedVideos = [...videos].sort((a, b) => {
    if (a.kind === b.kind) return a.scanIndex - b.scanIndex;
    return a.kind === 'repost' ? -1 : 1;
  });

  for (const v of sortedVideos) {
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    if (jobs.length >= maxItems) break;
    jobs.push({
      key: v.key,
      videoId: v.videoId,
      accountId: account,
      url: v.url,
      action: actionFor(v.kind),
      attempts: 0,
      status: 'pending',
      error: null,
      errorCode: null,
      processedAt: null,
    });
  }
  return {
    ...emptyQueue(),
    runId,
    account,
    status: 'running',
    jobs,
    createdAt: now,
    startedAt: now,
  };
}

/** Next job to run: fresh jobs first (fewest attempts), then scan order. */
export function nextPendingIndex(q: QueueState): number {
  let best = -1;
  for (let i = 0; i < q.jobs.length; i++) {
    const j = q.jobs[i];
    if (j.status !== 'pending') continue;
    if (best === -1 || j.attempts < q.jobs[best].attempts) best = i;
  }
  return best;
}

export function markProcessing(q: QueueState, index: number): QueueState {
  const jobs = q.jobs.slice();
  jobs[index] = { ...jobs[index], status: 'processing', attempts: jobs[index].attempts + 1 };
  return { ...q, jobs };
}

export interface ApplyOutcome {
  queue: QueueState;
  halted: boolean;
}

export function applyResult(
  q: QueueState,
  index: number,
  result: ActionResult,
  opts: { retryLimit: number; stopOnConsecutiveErrors: number; now: number },
): ApplyOutcome {
  const jobs = q.jobs.slice();
  const job = { ...jobs[index] };
  let next: QueueState = { ...q };
  let halted = false;

  if (
    (result.status === 'failed' || result.status === 'unverified') &&
    (result.haltRun || HALT_CODES.has(result.code))
  ) {
    // Run-level problem (CAPTCHA, rate limit, logout, account switch…): the job did not
    // really get a fair attempt, so it goes back to pending without consuming a retry.
    job.status = 'pending';
    job.attempts = Math.max(0, job.attempts - 1);
    job.error = result.message;
    job.errorCode = result.code;
    jobs[index] = job;
    next = { ...next, jobs, status: 'paused', reasonCode: result.code, reason: result.message };
    return { queue: next, halted: true };
  }

  job.error = result.status === 'success' ? null : result.message;
  job.errorCode = result.status === 'success' ? null : result.code;

  if (result.status === 'failed' || result.status === 'unverified') {
    const noAutoRetry = NO_AUTO_RETRY_CODES.has(result.code);
    const maxAttempts = noAutoRetry ? 1 : 1 + Math.max(0, opts.retryLimit);
    if (job.attempts >= maxAttempts) {
      job.status = result.status;
      job.processedAt = opts.now;
    } else {
      job.status = 'pending';
    }
    next.consecutiveErrors = q.consecutiveErrors + 1;
  } else {
    job.status = result.status;
    job.processedAt = opts.now;
    if (result.status !== 'unavailable') next.consecutiveErrors = 0;
  }
  jobs[index] = job;
  next.jobs = jobs;

  // Rolling-window determinacy & verification trackers (from lefewix/tiktok-mass-unliker v2.1.0)
  if (job.action === 'remove_like') {
    const detHist = [...(q.detHistory ?? [])];
    let detStreak = q.detStreak ?? 0;

    if (
      result.code === 'INDETERMINATE_LIKE_STATE' ||
      result.code === 'INDETERMINATE_BEFORE_CLICK'
    ) {
      detHist.push(false);
      if (detHist.length > TRACKER_WINDOW_SIZE) detHist.shift();
      detStreak += 1;
      next.detHistory = detHist;
      next.detStreak = detStreak;

      const detWindowFails = detHist.filter((ok) => !ok).length;
      if (
        detStreak >= DET_FAIL_STREAK_LIMIT ||
        (detHist.length >= DET_FAIL_WINDOW_LIMIT && detWindowFails >= DET_FAIL_WINDOW_LIMIT)
      ) {
        next.status = 'paused';
        next.reasonCode = 'INDETERMINATE_DOM';
        next.reason =
          'Tạm dừng an toàn: Không xác định được trạng thái nút Tim nhiều lần liên tiếp (DOM TikTok chưa tải đủ hoặc đã thay đổi).';
        halted = true;
      }
    } else if (
      result.status === 'success' ||
      result.code === 'ALREADY_UNLIKED' ||
      result.code === 'VERIFY_FAILED' ||
      result.code === 'VERIFY_INDETERMINATE'
    ) {
      detHist.push(true);
      if (detHist.length > TRACKER_WINDOW_SIZE) detHist.shift();
      next.detHistory = detHist;
      next.detStreak = 0;
    }

    const verHist = [...(q.verifyHistory ?? [])];
    let verStreak = q.verifyStreak ?? 0;
    let verTotal = q.verifyFailsTotal ?? 0;

    if (result.status === 'success') {
      verHist.push(true);
      if (verHist.length > TRACKER_WINDOW_SIZE) verHist.shift();
      next.verifyHistory = verHist;
      next.verifyStreak = 0;
    } else if (result.code === 'VERIFY_FAILED' || result.code === 'VERIFY_INDETERMINATE') {
      verHist.push(false);
      if (verHist.length > TRACKER_WINDOW_SIZE) verHist.shift();
      verStreak += 1;
      verTotal += 1;
      next.verifyHistory = verHist;
      next.verifyStreak = verStreak;
      next.verifyFailsTotal = verTotal;

      const verWindowFails = verHist.filter((ok) => !ok).length;
      if (verStreak >= VERIFY_FAIL_STREAK_LIMIT) {
        next.status = 'paused';
        next.reasonCode = 'VERIFY_STREAK';
        next.reason =
          'Tạm dừng an toàn: 2 lần bỏ tim liên tiếp chưa xác minh được trạng thái (TikTok có thể đang giới hạn tốc độ ngầm).';
        halted = true;
      } else if (verWindowFails >= VERIFY_FAIL_WINDOW_LIMIT) {
        next.status = 'paused';
        next.reasonCode = 'VERIFY_WINDOW';
        next.reason =
          'Tạm dừng an toàn: Có từ 3/10 lần bỏ tim gần nhất không xác minh được trạng thái.';
        halted = true;
      } else if (verTotal >= VERIFY_FAIL_TOTAL_CEILING) {
        next.status = 'paused';
        next.reasonCode = 'VERIFY_CEILING';
        next.reason =
          'Tạm dừng an toàn: Đã chạm ngưỡng 10 lần không xác minh được bỏ tim trong phiên này.';
        halted = true;
      }
    }
  }

  if (!halted && next.consecutiveErrors >= opts.stopOnConsecutiveErrors) {
    next.status = 'paused';
    next.reasonCode = 'TOO_MANY_ERRORS';
    next.reason = `Paused after ${next.consecutiveErrors} consecutive errors`;
    halted = true;
  }
  return { queue: next, halted };
}

export function requestPause(q: QueueState): QueueState {
  if (q.status === 'running') return { ...q, status: 'pausing', reasonCode: 'USER_PAUSE', reason: 'Paused by user' };
  return q;
}

/** Called by the runner when the in-flight job finished and a pause was requested. */
export function settlePause(q: QueueState): QueueState {
  if (q.status === 'pausing') return { ...q, status: 'paused' };
  return q;
}

export function canResume(q: QueueState): boolean {
  return (q.status === 'paused' || q.status === 'pausing' || q.status === 'stopped') && nextPendingIndex(q) !== -1;
}

export function resume(q: QueueState): QueueState {
  if (!canResume(q)) return q;
  const jobs = q.jobs.map((j) =>
    j.status === 'processing' ? { ...j, status: 'pending' as const, attempts: Math.max(0, j.attempts - 1) } : j,
  );
  return {
    ...q,
    jobs,
    status: 'running',
    reasonCode: null,
    reason: null,
    finishedAt: null,
    consecutiveErrors: 0,
    verifyStreak: 0,
    detStreak: 0,
    verifyHistory: [],
    detHistory: [],
    verifyFailsTotal: q.reasonCode === 'VERIFY_CEILING' ? 0 : (q.verifyFailsTotal ?? 0),
  };
}

/**
 * Stop: immediately halt new actions while preserving completed progress and keeping
 * unprocessed items as 'pending' so the user can safely Resume later (per tiktokRepostRemover).
 */
export function stop(q: QueueState, now: number, reason = 'Đã dừng dọn dẹp; tiến độ đã được lưu.', code = 'STOPPED'): QueueState {
  if (q.status === 'idle' || q.status === 'completed' || q.status === 'stopped') return q;
  const jobs = q.jobs.map((j) =>
    j.status === 'processing' ? { ...j, status: 'pending' as const, attempts: Math.max(0, j.attempts - 1) } : j,
  );
  return { ...q, jobs, status: 'stopped', reasonCode: code, reason, finishedAt: now };
}

export function complete(q: QueueState, now: number): QueueState {
  return { ...q, status: 'completed', finishedAt: now, reasonCode: null, reason: null };
}

/**
 * After a service-worker restart / browser crash nothing is running anymore.
 * A job left in "processing" may or may not have been applied — it is put back to
 * pending (it will be re-verified before acting) and the run is paused, never auto-resumed.
 */
export function recoverAfterRestart(q: QueueState): QueueState {
  if (!isActive(q) && !q.jobs.some((j) => j.status === 'processing')) return q;
  const jobs = q.jobs.map((j) =>
    j.status === 'processing' ? { ...j, status: 'pending' as const, attempts: Math.max(0, j.attempts - 1) } : j,
  );
  const status = isActive(q) ? 'paused' : q.status;
  return {
    ...q,
    jobs,
    status,
    reasonCode: isActive(q) ? 'INTERRUPTED' : q.reasonCode,
    reason: isActive(q) ? 'Interrupted (extension restarted). Review and press Resume to continue.' : q.reason,
  };
}

export interface QueueSummary {
  total: number;
  processed: number;
  success: number;
  failed: number;
  unverified: number;
  skipped: number;
  unavailable: number;
  pending: number;
  processing: number;
  percent: number;
}

export function summarize(q: QueueState): QueueSummary {
  const s: QueueSummary = {
    total: q.jobs.length,
    processed: 0,
    success: 0,
    failed: 0,
    unverified: 0,
    skipped: 0,
    unavailable: 0,
    pending: 0,
    processing: 0,
    percent: 0,
  };
  for (const j of q.jobs) {
    if (j.status === 'pending') s.pending++;
    else if (j.status === 'processing') s.processing++;
    else {
      s.processed++;
      if (j.status === 'success') s.success++;
      else if (j.status === 'failed') s.failed++;
      else if (j.status === 'unverified') s.unverified++;
      else if (j.status === 'skipped') s.skipped++;
      else if (j.status === 'unavailable') s.unavailable++;
    }
  }
  s.percent = s.total ? Math.round((s.processed / s.total) * 100) : 0;
  return s;
}
