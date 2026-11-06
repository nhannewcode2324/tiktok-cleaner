import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SafetyStopError,
  deleteRepostViaApi,
  listApiPage,
  scanKindViaApi,
} from '../src/content/tiktok-api';

describe('TikTok Paginated API & Deletion Engine', () => {
  const sentMessages: any[] = [];

  beforeEach(() => {
    sentMessages.length = 0;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn(async (msg: any) => {
          sentMessages.push(msg);
          return undefined; // Triggers direct fetch fallback in unit test environment
        }),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('paginates with cursor, excludes own posts, and stops automatically when hasMore is false', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status_code: 0,
            hasMore: true,
            cursor: '30',
            itemList: [
              { id: '111', desc: 'Other creator repost', author: { uniqueId: 'creator_a' } },
              { id: '222', desc: 'Own post should be skipped', author: { uniqueId: 'my_account' } },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status_code: 0,
            hasMore: false,
            cursor: '60',
            itemList: [
              { id: '333', desc: 'Second page repost', author: { uniqueId: 'creator_b' } },
            ],
          }),
          { status: 200 }
        )
      );

    // Override cooldown in test by mocking Math.random and fake timers? Better: use real timers on 1-page or mock setTimeout
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      if (ms && ms >= 200 && ms <= 5000) {
        return origSetTimeout(cb, 1);
      }
      return origSetTimeout(cb, ms);
    }) as typeof setTimeout);

    const summary = await scanKindViaApi('repost', 'SEC_UID_1', 'my_account', 500, [], () => false);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary.ok).toBe(true);
    expect(summary.code).toBe('COMPLETED');
    expect(summary.total).toBe(2); // '222' (own post) excluded, '111' and '333' kept
    expect(summary.pagesScanned).toBe(2);

    const batches = sentMessages.filter((m) => m.type === 'SCAN_BATCH');
    expect(batches).toHaveLength(2);
    expect(batches[0].items.map((x: any) => x.videoId)).toEqual(['111']);
    expect(batches[1].items.map((x: any) => x.videoId)).toEqual(['333']);
  });

  it('prevents infinite loops when TikTok returns a repeated pagination cursor', async () => {
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => origSetTimeout(cb, 1)) as typeof setTimeout);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: 0,
          hasMore: true, // Server claims hasMore, but cursor stays '0'
          cursor: '0',
          itemList: [{ id: '901', desc: 'Item', author: { uniqueId: 'other_user' } }],
        }),
        { status: 200 }
      )
    );

    const summary = await scanKindViaApi('repost', 'SEC_UID_1', 'my_account', 500, [], () => false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary.ok).toBe(true);
    expect(summary.total).toBe(1);
  });

  it('falls back from count=50 to count=30 when repost list returns HTTP 400', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Bad Request', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status_code: 0,
            hasMore: false,
            cursor: '30',
            itemList: [{ id: '777', desc: 'Fallback item', author: { uniqueId: 'creator_x' } }],
          }),
          { status: 200 }
        )
      );

    const page = await listApiPage('repost', 'SEC_UID_2', 'my_account', '0', 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('count=50');
    expect(String(fetchMock.mock.calls[1][0])).toContain('count=30');
    expect(page.items).toHaveLength(1);
    expect(page.items[0].videoId).toBe('777');
  });

  it('halts immediately without retrying when HTTP 403 is returned', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Access Denied', { status: 403 }));

    const summary = await scanKindViaApi('repost', 'SEC_UID_1', 'my_account', 500, [], () => false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Zero retries on 403!
    expect(summary.ok).toBe(false);
    expect(summary.code).toBe('HTTP_403');
    expect(summary.haltRun).toBe(true);
  });

  it('deletes repost via POST /tiktok/v1/upvote/delete and throws SafetyStopError on 429', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));

    await expect(deleteRepostViaApi('7123456789')).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/tiktok/v1/upvote/delete?aid=1988&item_id=7123456789');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');

    await expect(deleteRepostViaApi('7123456790')).rejects.toBeInstanceOf(SafetyStopError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Never retries POST
  });
});
