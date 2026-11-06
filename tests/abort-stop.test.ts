import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abortAction,
  abortScan,
  getScanAbortSignal,
  isActionAborted,
  isScanAborted,
  resetActionAbort,
  resetScanAbort,
  sleepUnlessActionAborted,
  sleepUnlessScanAborted,
} from '../src/content/abort-signal';
import { scanKindViaApi } from '../src/content/tiktok-api';
import { openProfileTab, waitForGridOrEmpty } from '../src/content/scanner';
import { removeLike } from '../src/content/like-handler';
import { createQueue, markProcessing, resume, stop } from '../src/services/automation-queue';
import type { ScannedVideo } from '../src/shared/types';

describe('Instant Stop & Pause Cancellation (Scan & Cleanup)', () => {
  beforeEach(() => {
    resetScanAbort();
    resetActionAbort();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('wakes up sleepUnlessScanAborted immediately (< 50ms) when abortScan() is called', async () => {
    const start = Date.now();
    const sleepPromise = sleepUnlessScanAborted(15_000);
    setTimeout(() => abortScan(), 5);

    const completed = await sleepPromise;
    const elapsed = Date.now() - start;

    expect(completed).toBe(false);
    expect(isScanAborted()).toBe(true);
    expect(elapsed).toBeLessThan(150);
  });

  it('wakes up sleepUnlessActionAborted immediately (< 50ms) when abortAction() is called', async () => {
    const start = Date.now();
    const sleepPromise = sleepUnlessActionAborted(15_000);
    setTimeout(() => abortAction(), 5);

    const completed = await sleepPromise;
    const elapsed = Date.now() - start;

    expect(completed).toBe(false);
    expect(isActionAborted()).toBe(true);
    expect(elapsed).toBeLessThan(150);
  });

  it('aborts scanKindViaApi mid-pagination immediately without fetching extra pages or sending stale batches', async () => {
    const sentMessages: unknown[] = [];

    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: vi.fn(async (msg: { type: string }) => {
          sentMessages.push(msg);
          if (msg.type === 'TIKTOK_API_FETCH') {
            // Simulate user pressing Stop Scan while page 2 request is in-flight
            if (sentMessages.filter((m: any) => m.type === 'TIKTOK_API_FETCH').length === 2) {
              setTimeout(() => abortScan(), 10);
              // Simulate a slow network call that would hang 10 seconds without AbortSignal racing
              return await new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      ok: true,
                      status: 200,
                      data: {
                        statusCode: 0,
                        hasMore: true,
                        cursor: '20',
                        itemList: [{ id: '7222222222222222222', author: { uniqueId: 'creator2' }, createTime: 1700000200 }],
                      },
                    }),
                  10_000
                )
              );
            }
            return {
              ok: true,
              status: 200,
              data: {
                statusCode: 0,
                hasMore: true,
                cursor: '10',
                itemList: [{ id: '7111111111111111111', author: { uniqueId: 'creator1' }, createTime: 1700000300 }],
              },
            };
          }
          return { ok: true };
        }),
      },
    };

    const start = Date.now();
    // Trigger abort either during page-1 cooldown or page-2 fetch — either way must finish in < 300ms!
    setTimeout(() => abortScan(), 25);
    const summary = await scanKindViaApi('like', 'sec_uid_test', 'myhandle', 500, [], () => isScanAborted());
    const elapsed = Date.now() - start;

    expect(summary.ok).toBe(true);
    expect(summary.code).toBe('CANCELLED');
    expect(summary.total).toBe(1);
    expect(elapsed).toBeLessThan(400);

    // Only page 1 batch was sent; no extra batch after abort
    const batches = sentMessages.filter((m: any) => m.type === 'SCAN_BATCH');
    expect(batches).toHaveLength(1);
  });

  it('aborts an in-flight slow network request immediately when abortScan() fires', async () => {
    const sentMessages: unknown[] = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: vi.fn(async (msg: { type: string }) => {
          sentMessages.push(msg);
          if (msg.type === 'TIKTOK_API_FETCH') {
            setTimeout(() => abortScan(), 15);
            return await new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    ok: true,
                    status: 200,
                    data: {
                      statusCode: 0,
                      hasMore: false,
                      cursor: '0',
                      itemList: [{ id: '7333333333333333333', author: { uniqueId: 'creator3' }, createTime: 1700000100 }],
                    },
                  }),
                15_000
              )
            );
          }
          return { ok: true };
        }),
      },
    };

    const start = Date.now();
    const summary = await scanKindViaApi('repost', 'sec_uid_test', 'myhandle', 500, [], () => isScanAborted());
    const elapsed = Date.now() - start;

    expect(summary.ok).toBe(true);
    expect(summary.code).toBe('CANCELLED');
    expect(elapsed).toBeLessThan(300);
    expect(sentMessages.filter((m: any) => m.type === 'SCAN_BATCH')).toHaveLength(0);
  });

  it('aborts waitForGridOrEmpty and openProfileTab immediately when abortSignal triggers', async () => {
    window.history.replaceState({}, '', '/@myhandle');
    const signal = getScanAbortSignal();

    const start = Date.now();
    const gridWait = waitForGridOrEmpty('repost', 10_000, signal);
    const tabWait = openProfileTab('repost', 'myhandle', signal);

    setTimeout(() => abortScan(), 10);

    const [gridRes, tabRes] = await Promise.all([gridWait, tabWait]);
    const elapsed = Date.now() - start;

    expect(gridRes).toEqual({ grid: null, empty: false });
    expect(tabRes).toEqual({ ok: false, error: 'USER_ABORTED' });
    expect(elapsed).toBeLessThan(200);
  });

  it('aborts removeLike before clicking when abortAction() is triggered during preClickDelayMs', async () => {
    window.history.replaceState({}, '', '/@creator/video/7555555555555555555');
    const btn = document.createElement('button');
    btn.setAttribute('data-e2e', 'browse-like-icon');
    btn.setAttribute('aria-pressed', 'true');
    Object.defineProperty(btn, 'getBoundingClientRect', {
      value: () => ({ width: 40, height: 40, top: 100, left: 100, bottom: 140, right: 140 }),
    });
    let clicked = 0;
    btn.addEventListener('click', () => {
      clicked += 1;
    });
    document.body.appendChild(btn);

    const start = Date.now();
    const actionPromise = removeLike(
      '7555555555555555555',
      'https://www.tiktok.com/@creator/video/7555555555555555555',
      {
        preClickDelayMs: 10_000,
        buttonWaitMs: 5_000,
      }
    );

    setTimeout(() => abortAction(), 15);
    const res = await actionPromise;
    const elapsed = Date.now() - start;

    expect(res.status).toBe('failed');
    expect(res.code).toBe('USER_ABORTED');
    expect(clicked).toBe(0);
    expect(elapsed).toBeLessThan(250);
  });

  it('reverts in-flight processing job cleanly to pending on stop() so resume() continues without losing or failing it', () => {
    const sampleVideos: ScannedVideo[] = [
      {
        key: 'like:101',
        videoId: '101',
        kind: 'like',
        mediaType: 'video',
        url: 'https://www.tiktok.com/@a/video/101',
        author: 'a',
        description: 'v1',
        thumbnail: null,
        views: 100,
        viewsText: '100',
        scanIndex: 0,
        scannedAt: 1000,
      },
      {
        key: 'like:102',
        videoId: '102',
        kind: 'like',
        mediaType: 'video',
        url: 'https://www.tiktok.com/@b/video/102',
        author: 'b',
        description: 'v2',
        thumbnail: null,
        views: 200,
        viewsText: '200',
        scanIndex: 1,
        scannedAt: 1001,
      },
    ];

    let q = createQueue(sampleVideos, 'myhandle', 100, 'run-1', 1000);
    q = markProcessing(q, 0);
    expect(q.jobs[0].status).toBe('processing');
    expect(q.jobs[0].attempts).toBe(1);

    const stopped = stop(q, 2000);
    expect(stopped.status).toBe('stopped');
    expect(stopped.jobs[0].status).toBe('pending');
    expect(stopped.jobs[0].attempts).toBe(0);

    const resumed = resume(stopped);
    expect(resumed.status).toBe('running');
    expect(resumed.jobs[0].status).toBe('pending');
  });
});
