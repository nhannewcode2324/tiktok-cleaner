import { describe, expect, it } from 'vitest';
import type { ActionResult, ScannedVideo } from '../src/shared/types';
import {
  applyResult,
  canResume,
  createQueue,
  markProcessing,
  nextPendingIndex,
  recoverAfterRestart,
  requestPause,
  resume,
  settlePause,
  stop,
} from '../src/services/automation-queue';

const mockVideos: ScannedVideo[] = [
  {
    key: 'repost:101',
    videoId: '101',
    kind: 'repost',
    mediaType: 'video',
    url: 'https://www.tiktok.com/@u/video/101',
    author: 'u',
    description: 'v1',
    thumbnail: null,
    viewsText: null,
    views: null,
    scanIndex: 0,
    scannedAt: 100,
  },
  {
    key: 'like:102',
    videoId: '102',
    kind: 'like',
    mediaType: 'video',
    url: 'https://www.tiktok.com/@u/video/102',
    author: 'u',
    description: 'v2',
    thumbnail: null,
    viewsText: null,
    views: null,
    scanIndex: 1,
    scannedAt: 200,
  },
];

describe('Automation Queue State Machine', () => {
  it('creates a fresh queue without duplicates and sets initial running state', () => {
    const q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    expect(q.runId).toBe('run_1');
    expect(q.account).toBe('test_user');
    expect(q.status).toBe('running');
    expect(q.jobs.length).toBe(2);
    expect(q.jobs[0].action).toBe('remove_repost');
    expect(q.jobs[1].action).toBe('remove_like');
    expect(q.jobs[0].status).toBe('pending');
  });

  it('marks processing and increments attempts', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    const idx = nextPendingIndex(q);
    expect(idx).toBe(0);

    q = markProcessing(q, idx);
    expect(q.jobs[0].status).toBe('processing');
    expect(q.jobs[0].attempts).toBe(1);
  });

  it('applies successful action result', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = markProcessing(q, 0);

    const res: ActionResult = { status: 'success', code: 'SUCCESS', message: 'Removed' };
    const outcome = applyResult(q, 0, res, { retryLimit: 2, stopOnConsecutiveErrors: 5, now: 1200 });

    expect(outcome.halted).toBe(false);
    expect(outcome.queue.jobs[0].status).toBe('success');
    expect(outcome.queue.jobs[0].processedAt).toBe(1200);
    expect(outcome.queue.consecutiveErrors).toBe(0);
  });

  it('retries on failure up to retry limit, then fails job', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = markProcessing(q, 0); // attempts = 1

    const failRes: ActionResult = { status: 'failed', code: 'BTN_ERR', message: 'Not found' };
    
    // First failure (retry limit = 1 -> max attempts = 2)
    let outcome = applyResult(q, 0, failRes, { retryLimit: 1, stopOnConsecutiveErrors: 5, now: 1200 });
    expect(outcome.queue.jobs[0].status).toBe('pending'); // retrying

    // Second failure
    q = markProcessing(outcome.queue, 0); // attempts = 2
    outcome = applyResult(q, 0, failRes, { retryLimit: 1, stopOnConsecutiveErrors: 5, now: 1300 });
    expect(outcome.queue.jobs[0].status).toBe('failed'); // exceeded retry limit
  });

  it('halts run immediately when CAPTCHA is detected', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = markProcessing(q, 0);

    const captchaRes: ActionResult = {
      status: 'failed',
      code: 'CAPTCHA',
      message: 'CAPTCHA detected',
      haltRun: true,
    };

    const outcome = applyResult(q, 0, captchaRes, { retryLimit: 2, stopOnConsecutiveErrors: 5, now: 1200 });
    expect(outcome.halted).toBe(true);
    expect(outcome.queue.status).toBe('paused');
    expect(outcome.queue.reasonCode).toBe('CAPTCHA');
    // Does not consume an attempt for security halt
    expect(outcome.queue.jobs[0].status).toBe('pending');
  });

  it('halts run immediately when HTTP_403 is encountered', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = markProcessing(q, 0);

    const http403Res: ActionResult = {
      status: 'failed',
      code: 'HTTP_403',
      message: 'Access to www.tiktok.com was denied',
      haltRun: true,
    };

    const outcome = applyResult(q, 0, http403Res, { retryLimit: 2, stopOnConsecutiveErrors: 5, now: 1200 });
    expect(outcome.halted).toBe(true);
    expect(outcome.queue.status).toBe('paused');
    expect(outcome.queue.reasonCode).toBe('HTTP_403');
    expect(outcome.queue.jobs[0].status).toBe('pending');
  });

  it('pauses and resumes gracefully', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = requestPause(q);
    expect(q.status).toBe('pausing');

    q = settlePause(q);
    expect(q.status).toBe('paused');
    expect(canResume(q)).toBe(true);

    q = resume(q);
    expect(q.status).toBe('running');
  });

  it('stops cleanly while preserving pending jobs so progress can be resumed', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = markProcessing(q, 0);
    q = stop(q, 2000, 'User stopped');
    expect(q.status).toBe('stopped');
    expect(q.jobs.every((j) => j.status === 'pending')).toBe(true);
    expect(canResume(q)).toBe(true);

    q = resume(q);
    expect(q.status).toBe('running');
  });

  it('recovers interrupted jobs safely after extension restart', () => {
    let q = createQueue(mockVideos, 'test_user', 50, 'run_1', 1000);
    q = markProcessing(q, 0);
    expect(q.jobs[0].status).toBe('processing');

    const recovered = recoverAfterRestart(q);
    expect(recovered.status).toBe('paused');
    expect(recovered.jobs[0].status).toBe('pending');
    expect(recovered.reasonCode).toBe('INTERRUPTED');
  });

  it('never auto-retries VERIFY_FAILED on remove_like (prevents double-clicking / re-liking) and pauses on 2 consecutive VERIFY_FAILED', () => {
    const likeVideos: ScannedVideo[] = Array.from({ length: 4 }, (_, i) => ({
      key: `like:${500 + i}`,
      videoId: `${500 + i}`,
      kind: 'like' as const,
      mediaType: 'video' as const,
      url: `https://www.tiktok.com/@creator/video/${500 + i}`,
      author: 'creator',
      description: `like ${i}`,
      thumbnail: null,
      viewsText: null,
      views: null,
      scanIndex: i,
      scannedAt: 100 + i,
    }));

    let q = createQueue(likeVideos, 'test_user', 50, 'run_like', 1000);
    expect(q.jobs.map((j) => j.videoId)).toEqual(['500', '501', '502', '503']);

    // 1st VERIFY_FAILED: marks job failed immediately even when retryLimit = 3 (no second click!)
    q = markProcessing(q, 0);
    const verifyFail: ActionResult = {
      status: 'failed',
      code: 'VERIFY_FAILED',
      message: 'State did not flip',
    };
    let outcome = applyResult(q, 0, verifyFail, { retryLimit: 3, stopOnConsecutiveErrors: 5, now: 1100 });
    expect(outcome.queue.jobs[0].status).toBe('failed');
    expect(outcome.halted).toBe(false);

    // 2nd consecutive VERIFY_FAILED -> triggers VERIFY_STREAK pause
    q = markProcessing(outcome.queue, 1);
    outcome = applyResult(q, 1, verifyFail, { retryLimit: 3, stopOnConsecutiveErrors: 5, now: 1200 });
    expect(outcome.halted).toBe(true);
    expect(outcome.queue.status).toBe('paused');
    expect(outcome.queue.reasonCode).toBe('VERIFY_STREAK');
    expect(outcome.queue.jobs[2].status).toBe('pending');
  });

  it('pauses on VERIFY_WINDOW when 3 of 10 recent unlikes fail verification even if non-consecutive', () => {
    const likeVideos: ScannedVideo[] = Array.from({ length: 6 }, (_, i) => ({
      key: `like:${600 + i}`,
      videoId: `${600 + i}`,
      kind: 'like' as const,
      mediaType: 'video' as const,
      url: `https://www.tiktok.com/@creator/video/${600 + i}`,
      author: 'creator',
      description: `like ${i}`,
      thumbnail: null,
      viewsText: null,
      views: null,
      scanIndex: i,
      scannedAt: 100 + i,
    }));

    let q = createQueue(likeVideos, 'test_user', 50, 'run_win', 1000);
    const okRes: ActionResult = { status: 'success', code: 'SUCCESS', message: 'ok' };
    const failRes: ActionResult = { status: 'failed', code: 'VERIFY_FAILED', message: 'fail' };
    // Pattern: fail, ok, fail, ok, fail -> 3 failures in window of 5 without any 2-in-a-row streak
    const pattern = [failRes, okRes, failRes, okRes, failRes];
    let halted = false;

    for (let i = 0; i < pattern.length; i++) {
      q = markProcessing(q, i);
      const out = applyResult(q, i, pattern[i], { retryLimit: 2, stopOnConsecutiveErrors: 10, now: 1100 + i });
      q = out.queue;
      halted = out.halted;
    }

    expect(halted).toBe(true);
    expect(q.status).toBe('paused');
    expect(q.reasonCode).toBe('VERIFY_WINDOW');
  });

  it('pauses on INDETERMINATE_DOM after 4 consecutive indeterminate like button reads', () => {
    const likeVideos: ScannedVideo[] = Array.from({ length: 5 }, (_, i) => ({
      key: `like:${700 + i}`,
      videoId: `${700 + i}`,
      kind: 'like' as const,
      mediaType: 'video' as const,
      url: `https://www.tiktok.com/@creator/video/${700 + i}`,
      author: 'creator',
      description: `like ${i}`,
      thumbnail: null,
      viewsText: null,
      views: null,
      scanIndex: i,
      scannedAt: 100 + i,
    }));

    let q = createQueue(likeVideos, 'test_user', 50, 'run_det', 1000);
    const indetRes: ActionResult = {
      status: 'failed',
      code: 'INDETERMINATE_LIKE_STATE',
      message: 'Indeterminate',
    };

    let halted = false;
    for (let i = 0; i < 4; i++) {
      q = markProcessing(q, i);
      const out = applyResult(q, i, indetRes, { retryLimit: 2, stopOnConsecutiveErrors: 10, now: 1100 + i });
      q = out.queue;
      halted = out.halted;
    }

    expect(halted).toBe(true);
    expect(q.status).toBe('paused');
    expect(q.reasonCode).toBe('INDETERMINATE_DOM');
    expect(q.jobs[4].status).toBe('pending');
  });
});
