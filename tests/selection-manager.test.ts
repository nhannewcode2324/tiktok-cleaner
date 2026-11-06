import { describe, expect, it } from 'vitest';
import type { ResultRecord, ScannedVideo } from '../src/shared/types';
import {
  computeStats,
  deselectAll,
  filterVideos,
  invertSelection,
  matchesSearch,
  selectAllInModes,
  selectKind,
  selectUnavailable,
  sortVideos,
  toggle,
} from '../src/services/selection-manager';

const mockVideos: ScannedVideo[] = [
  {
    key: 'repost:1001',
    videoId: '1001',
    kind: 'repost',
    mediaType: 'video',
    url: 'https://www.tiktok.com/@creator_a/video/1001',
    author: 'creator_a',
    description: 'Funny cat video #cute',
    thumbnail: 'https://p16.tiktokcdn.com/cat.jpg',
    viewsText: '10.5K',
    views: 10500,
    scanIndex: 0,
    scannedAt: 1000,
  },
  {
    key: 'like:1002',
    videoId: '1002',
    kind: 'like',
    mediaType: 'video',
    url: 'https://www.tiktok.com/@creator_b/video/1002',
    author: 'creator_b',
    description: 'Cooking tutorial delicious pasta',
    thumbnail: 'https://p16.tiktokcdn.com/pasta.jpg',
    viewsText: '500K',
    views: 500000,
    scanIndex: 1,
    scannedAt: 2000,
  },
  {
    key: 'like:1003',
    videoId: '1003',
    kind: 'like',
    mediaType: 'video',
    url: 'https://www.tiktok.com/@creator_c/video/1003',
    author: 'creator_c',
    description: 'Dance trend choreography',
    thumbnail: null,
    viewsText: null,
    views: null,
    scanIndex: 2,
    scannedAt: 3000,
  },
];

const mockResults: Record<string, ResultRecord> = {
  'like:1002': { status: 'success', error: null, processedAt: 5000 },
};

describe('Selection Manager', () => {
  it('toggles selection properly', () => {
    let sel = new Set<string>();
    sel = toggle(sel, 'repost:1001');
    expect(sel.has('repost:1001')).toBe(true);
    sel = toggle(sel, 'repost:1001');
    expect(sel.has('repost:1001')).toBe(false);
  });

  it('selects all eligible items in modes', () => {
    const sel = selectAllInModes(mockVideos, mockResults, ['repost', 'like']);
    expect(sel.has('repost:1001')).toBe(true);
    // 1002 was already cleaned successfully, so it shouldn't be selected
    expect(sel.has('like:1002')).toBe(false);
    expect(sel.has('like:1003')).toBe(true);
  });

  it('selects by kind', () => {
    const reposts = selectKind(mockVideos, {}, 'repost');
    expect(reposts.has('repost:1001')).toBe(true);
    expect(reposts.has('like:1002')).toBe(false);

    const likes = selectKind(mockVideos, {}, 'like');
    expect(likes.has('like:1002')).toBe(true);
    expect(likes.has('like:1003')).toBe(true);
    expect(likes.has('repost:1001')).toBe(false);
  });

  it('inverts selection inside visible scope', () => {
    let sel = new Set<string>(['repost:1001']);
    sel = invertSelection(sel, mockVideos, {});
    expect(sel.has('repost:1001')).toBe(false);
    expect(sel.has('like:1002')).toBe(true);
    expect(sel.has('like:1003')).toBe(true);
  });

  it('deselects all', () => {
    const sel = deselectAll();
    expect(sel.size).toBe(0);
  });

  it('filters by search term (case and diacritics insensitive)', () => {
    expect(matchesSearch(mockVideos[0], 'cat')).toBe(true);
    expect(matchesSearch(mockVideos[0], '@creator_a')).toBe(true);
    expect(matchesSearch(mockVideos[1], 'PASTA')).toBe(true);
    expect(matchesSearch(mockVideos[1], 'nonexistent')).toBe(false);
  });

  it('sorts videos in MỚI NHẤT → CŨ NHẤT order by default (`newest`) matching TikTok source order', () => {
    // TikTok returns newest liked/reposted video first (scanIndex 0), older ones after (scanIndex 1, 2)
    const shuffled = [mockVideos[2], mockVideos[0], mockVideos[1]];
    const newestFirst = sortVideos(shuffled, 'newest');
    expect(newestFirst.map((v) => v.videoId)).toEqual(['1001', '1002', '1003']);

    const oldestFirst = sortVideos(shuffled, 'oldest');
    expect(oldestFirst.map((v) => v.videoId)).toEqual(['1003', '1002', '1001']);

    const byViewsDesc = sortVideos(mockVideos, 'views_desc');
    expect(byViewsDesc[0].videoId).toBe('1002'); // 500k
    expect(byViewsDesc[1].videoId).toBe('1001'); // 10.5k
    expect(byViewsDesc[2].videoId).toBe('1003'); // null views last

    const byAuthor = sortVideos(mockVideos, 'author_asc');
    expect(byAuthor[0].author).toBe('creator_a');
    expect(byAuthor[1].author).toBe('creator_b');
    expect(byAuthor[2].author).toBe('creator_c');
  });

  it('sorts by verified publish timestamp (`post_newest`) without guessing dates from videoId', () => {
    const videosWithCreateTime: ScannedVideo[] = [
      // Smaller ID but verified newer createTime
      { ...mockVideos[0], videoId: '7000000000000000001', createTime: 1730000000, scanIndex: 2 },
      // Larger ID but verified older createTime
      { ...mockVideos[1], videoId: '7499999999999999999', createTime: 1710000000, scanIndex: 0 },
      // No verified createTime -> placed after verified timestamps in TikTok source order
      { ...mockVideos[2], videoId: '7599999999999999999', createTime: null, scanIndex: 1 },
    ];

    const byPostTime = sortVideos(videosWithCreateTime, 'post_newest');
    expect(byPostTime.map((v) => v.videoId)).toEqual([
      '7000000000000000001',
      '7499999999999999999',
      '7599999999999999999',
    ]);
  });

  it('appends newly scanned older batches at the bottom and preserves MỚI NHẤT → CŨ NHẤT across select/deselect/tab switches', () => {
    // Batch 1 (Page 1 from TikTok: newest -> older)
    const page1: ScannedVideo[] = [
      { ...mockVideos[0], key: 'like:9001', videoId: '9001', kind: 'like', scanIndex: 0 },
      { ...mockVideos[1], key: 'like:9002', videoId: '9002', kind: 'like', scanIndex: 1 },
    ];
    // Batch 2 (Page 2 scrolled down: even older videos with monotonic scanIndex 2, 3)
    const page2: ScannedVideo[] = [
      { ...mockVideos[2], key: 'like:8001', videoId: '8001', kind: 'like', scanIndex: 2 },
      { ...mockVideos[2], key: 'repost:8002', videoId: '8002', kind: 'repost', scanIndex: 3 },
    ];

    const combined = [...page1, ...page2];
    expect(sortVideos(combined, 'newest').map((v) => v.key)).toEqual([
      'like:9001',
      'like:9002',
      'like:8001',
      'repost:8002',
    ]);

    // Select all -> order stays identical
    const allSel = selectAllInModes(combined, {}, ['repost', 'like']);
    const afterSelectAll = filterVideos(combined, allSel, {}, {
      filter: 'all',
      search: '',
      sort: 'newest',
    });
    expect(afterSelectAll.map((v) => v.key)).toEqual([
      'like:9001',
      'like:9002',
      'like:8001',
      'repost:8002',
    ]);

    // Switch filter tab to 'like' -> relative MỚI NHẤT → CŨ NHẤT order preserved
    const likesTab = filterVideos(combined, allSel, {}, {
      filter: 'like',
      search: '',
      sort: 'newest',
    });
    expect(likesTab.map((v) => v.key)).toEqual(['like:9001', 'like:9002', 'like:8001']);

    // Switch filter tab to 'selected' -> order preserved
    const selectedTab = filterVideos(combined, allSel, {}, {
      filter: 'selected',
      search: '',
      sort: 'newest',
    });
    expect(selectedTab.map((v) => v.key)).toEqual([
      'like:9001',
      'like:9002',
      'like:8001',
      'repost:8002',
    ]);

    // Deselect all & switch back to 'all' -> order preserved
    const emptySel = deselectAll();
    const afterDeselect = filterVideos(combined, emptySel, {}, {
      filter: 'all',
      search: '',
      sort: 'newest',
    });
    expect(afterDeselect.map((v) => v.key)).toEqual([
      'like:9001',
      'like:9002',
      'like:8001',
      'repost:8002',
    ]);
  });

  it('computes real-time statistics accurately and enforces Đã chọn = Reposts đã chọn + Likes đã chọn', () => {
    const sel = new Set(['repost:1001', 'like:1003']);
    const stats = computeStats(mockVideos, sel, mockResults);

    expect(stats.totalScanned).toBe(3);
    expect(stats.totalReposts).toBe(1);
    expect(stats.totalLikes).toBe(2);
    expect(stats.totalSelected).toBe(2);
    expect(stats.selectedReposts).toBe(1);
    expect(stats.selectedLikes).toBe(1);
    // Guarantees: Đã chọn = Reposts đã chọn + Likes đã chọn
    expect(stats.totalSelected).toBe(stats.selectedReposts + stats.selectedLikes);
    expect(stats.cleaned).toBe(1); // 1002
    expect(stats.remaining).toBe(2);

    // Dynamic test: Selecting 10 items, deselecting 3 -> verifies counter is exact
    const tenVideos: ScannedVideo[] = Array.from({ length: 10 }, (_, i) => ({
      key: `${i < 6 ? 'repost' : 'like'}:${2000 + i}`,
      videoId: `${2000 + i}`,
      kind: i < 6 ? ('repost' as const) : ('like' as const),
      mediaType: 'video' as const,
      url: `https://tiktok.com/@user/video/${2000 + i}`,
      author: 'user',
      description: `Video ${i}`,
      thumbnail: null,
      viewsText: null,
      views: null,
      scanIndex: i,
      scannedAt: Date.now(),
    }));

    let tenSel = new Set(tenVideos.map((v) => v.key));
    let tenStats = computeStats(tenVideos, tenSel, {});
    expect(tenStats.totalSelected).toBe(10);
    expect(tenStats.selectedReposts).toBe(6);
    expect(tenStats.selectedLikes).toBe(4);
    expect(tenStats.totalSelected).toBe(tenStats.selectedReposts + tenStats.selectedLikes);

    // Deselect 3 videos (2 reposts, 1 like)
    tenSel.delete('repost:2000');
    tenSel.delete('repost:2001');
    tenSel.delete('like:2009');
    tenStats = computeStats(tenVideos, tenSel, {});
    expect(tenStats.totalSelected).toBe(7);
    expect(tenStats.selectedReposts).toBe(4);
    expect(tenStats.selectedLikes).toBe(3);
    expect(tenStats.totalSelected).toBe(tenStats.selectedReposts + tenStats.selectedLikes);
  });

  it('selects unavailable / hidden videos', () => {
    const videosWithUnavail = [
      ...mockVideos,
      {
        key: 'like:1004',
        videoId: '1004',
        kind: 'like' as const,
        mediaType: 'video' as const,
        url: 'https://www.tiktok.com/@creator_d/video/1004',
        author: 'creator_d',
        description: 'deleted',
        thumbnail: null,
        viewsText: null,
        views: null,
        isUnavailable: true,
        scanIndex: 3,
        scannedAt: 4000,
      },
    ];
    const unavail = selectUnavailable(videosWithUnavail, {});
    expect(unavail.has('like:1004')).toBe(true);
    expect(unavail.has('like:1002')).toBe(false);
  });

  it('strictly adheres to formula: Thành công + Thất bại + Còn lại = Tổng số được chọn ban đầu', () => {
    const testVideos: ScannedVideo[] = Array.from({ length: 300 }, (_, i) => ({
      key: `repost:${3000 + i}`,
      videoId: `${3000 + i}`,
      kind: 'repost' as const,
      mediaType: 'video' as const,
      url: `https://tiktok.com/@author/video/${3000 + i}`,
      author: 'author',
      description: `Video ${i}`,
      thumbnail: null,
      viewsText: null,
      views: null,
      scanIndex: i,
      scannedAt: Date.now(),
    }));

    const allSelected = new Set(testVideos.map((v) => v.key));
    const partialResults: Record<string, ResultRecord> = {};

    // 120 success
    for (let i = 0; i < 120; i++) {
      partialResults[`repost:${3000 + i}`] = { status: 'success', error: null, processedAt: Date.now() };
    }
    // 5 failed
    for (let i = 120; i < 125; i++) {
      partialResults[`repost:${3000 + i}`] = { status: 'failed', error: 'error', processedAt: Date.now() };
    }
    // Remaining = 300 - 120 - 5 = 175

    const stats = computeStats(testVideos, allSelected, partialResults);
    expect(stats.totalSelected).toBe(300);
    expect(stats.cleaned).toBe(120);
    expect(stats.failed).toBe(5);
    expect(stats.remaining).toBe(175);
    expect(stats.cleaned + stats.failed + stats.remaining).toBe(stats.totalSelected);
  });
});
