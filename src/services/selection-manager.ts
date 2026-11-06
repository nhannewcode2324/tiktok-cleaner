import type { ResultRecord, ScannedVideo, VideoKind } from '../shared/types';
import { normalizeText } from '../shared/utils';

/**
 * Selection Manager — pure functions (no chrome APIs) so they are unit-testable.
 * Selection is always represented as a Set of video keys (`kind:videoId`).
 */

export type FilterKind =
  | 'all'
  | 'repost'
  | 'like'
  | 'selected'
  | 'unselected'
  | 'success'
  | 'failed'
  | 'unavailable';

export type SortKey =
  | 'newest'
  | 'oldest'
  | 'post_newest'
  | 'scan_asc'
  | 'scan_desc'
  | 'views_desc'
  | 'views_asc'
  | 'author_asc';

export interface FilterOptions {
  filter: FilterKind;
  search: string;
  sort: SortKey;
}

export type Results = Record<string, ResultRecord | undefined>;

/** A video is eligible for cleanup unless it was already cleaned or is unavailable. */
export function isEligible(v: ScannedVideo, results: Results): boolean {
  const r = results[v.key];
  if (!r) return true;
  return r.status !== 'success' && r.status !== 'unavailable' && r.status !== 'skipped';
}

export function matchesSearch(v: ScannedVideo, search: string): boolean {
  const q = normalizeText(search).replace(/^@/, '');
  if (!q) return true;
  return normalizeText(v.author).includes(q) || normalizeText(v.description).includes(q);
}

export function matchesFilter(v: ScannedVideo, filter: FilterKind, selected: Set<string>, results: Results): boolean {
  const st = results[v.key]?.status;
  switch (filter) {
    case 'all':
      return true;
    case 'repost':
      return v.kind === 'repost';
    case 'like':
      return v.kind === 'like';
    case 'selected':
      return selected.has(v.key);
    case 'unselected':
      return !selected.has(v.key);
    case 'success':
      return st === 'success' || st === 'skipped';
    case 'failed':
      return st === 'failed' || st === 'unverified';
    case 'unavailable':
      return st === 'unavailable' || v.isUnavailable === true;
    default:
      return true;
  }
}

export function sortVideos(list: ScannedVideo[], sort: SortKey = 'newest'): ScannedVideo[] {
  const out = list.slice();
  switch (sort) {
    case 'newest':
    case 'scan_asc':
      // TikTok returns & renders items from Newest (index 0) -> Oldest (index N).
      out.sort((a, b) => a.scanIndex - b.scanIndex);
      break;
    case 'oldest':
    case 'scan_desc':
      out.sort((a, b) => b.scanIndex - a.scanIndex);
      break;
    case 'post_newest':
      // Uses verified post publish timestamp when provided by TikTok; never guesses from videoId.
      out.sort((a, b) => {
        const ta = typeof a.createTime === 'number' && a.createTime > 0 ? a.createTime : null;
        const tb = typeof b.createTime === 'number' && b.createTime > 0 ? b.createTime : null;
        if (ta !== null && tb !== null && ta !== tb) return tb - ta;
        if (ta !== null && tb === null) return -1;
        if (ta === null && tb !== null) return 1;
        return a.scanIndex - b.scanIndex;
      });
      break;
    case 'views_desc':
      // Videos without view data always go last — we never invent numbers.
      out.sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.scanIndex - b.scanIndex);
      break;
    case 'views_asc':
      out.sort((a, b) => {
        if (a.views === null && b.views === null) return a.scanIndex - b.scanIndex;
        if (a.views === null) return 1;
        if (b.views === null) return -1;
        return a.views - b.views || a.scanIndex - b.scanIndex;
      });
      break;
    case 'author_asc':
      out.sort((a, b) => a.author.localeCompare(b.author) || a.scanIndex - b.scanIndex);
      break;
    default:
      out.sort((a, b) => a.scanIndex - b.scanIndex);
      break;
  }
  return out;
}

export function filterVideos(
  videos: ScannedVideo[],
  selected: Set<string>,
  results: Results,
  opts: FilterOptions,
): ScannedVideo[] {
  const filtered = videos.filter((v) => matchesFilter(v, opts.filter, selected, results) && matchesSearch(v, opts.search));
  return sortVideos(filtered, opts.sort);
}

// ---------- selection operations (all return a NEW Set) ----------

export function toggle(selected: Set<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function deselectAll(): Set<string> {
  return new Set();
}

/** Select every eligible scanned video, regardless of filters or mode. */
export function selectAllScanned(videos: ScannedVideo[], results: Results): Set<string> {
  return new Set(videos.filter((v) => isEligible(v, results)).map((v) => v.key));
}

/** "Select All" in the toolbar: every eligible video whose kind is in the active cleanup modes. */
export function selectAllInModes(videos: ScannedVideo[], results: Results, modes: VideoKind[]): Set<string> {
  const m = new Set(modes);
  return new Set(videos.filter((v) => m.has(v.kind) && isEligible(v, results)).map((v) => v.key));
}

/** Replace the selection with exactly the eligible videos of one kind. */
export function selectKind(videos: ScannedVideo[], results: Results, kind: VideoKind): Set<string> {
  return new Set(videos.filter((v) => v.kind === kind && isEligible(v, results)).map((v) => v.key));
}

/** Replace the selection with exactly the eligible videos currently visible after filters/search. */
export function selectVisible(visible: ScannedVideo[], results: Results): Set<string> {
  return new Set(visible.filter((v) => isEligible(v, results)).map((v) => v.key));
}

/** Replace the selection with exactly the videos that are deleted or hidden. */
export function selectUnavailable(videos: ScannedVideo[], results: Results): Set<string> {
  return new Set(
    videos
      .filter((v) => v.isUnavailable || results[v.key]?.status === 'unavailable')
      .map((v) => v.key)
  );
}

/**
 * Invert selection inside a scope (normally the visible list). Items outside the scope
 * keep their current state so a filter never silently changes hidden selections.
 */
export function invertSelection(selected: Set<string>, scope: ScannedVideo[], results: Results): Set<string> {
  const next = new Set(selected);
  for (const v of scope) {
    if (next.has(v.key)) next.delete(v.key);
    else if (isEligible(v, results)) next.add(v.key);
  }
  return next;
}

/** Drop keys that no longer exist (e.g. after cache clear). */
export function pruneSelection(selected: Set<string>, videos: ScannedVideo[]): Set<string> {
  const keys = new Set(videos.map((v) => v.key));
  return new Set([...selected].filter((k) => keys.has(k)));
}

/** The list that will actually be processed, in scan order. */
export function eligibleSelected(videos: ScannedVideo[], selected: Set<string>, results: Results): ScannedVideo[] {
  return videos
    .filter((v) => selected.has(v.key) && isEligible(v, results))
    .sort((a, b) => a.scanIndex - b.scanIndex);
}

export interface SelectionStats {
  totalScanned: number;
  totalReposts: number;
  totalLikes: number;
  totalSelected: number;
  selectedReposts: number;
  selectedLikes: number;
  eligibleSelected: number;
  cleaned: number;
  failed: number;
  unavailable: number;
  remaining: number;
}

export function computeStats(videos: ScannedVideo[], selected: Set<string>, results: Results): SelectionStats {
  const s: SelectionStats = {
    totalScanned: videos.length,
    totalReposts: 0,
    totalLikes: 0,
    totalSelected: 0,
    selectedReposts: 0,
    selectedLikes: 0,
    eligibleSelected: 0,
    cleaned: 0,
    failed: 0,
    unavailable: 0,
    remaining: 0,
  };

  let selectedCleaned = 0;
  let selectedFailed = 0;
  let selectedUnavailable = 0;

  for (const v of videos) {
    const isSel = selected.has(v.key);
    if (v.kind === 'repost') s.totalReposts++;
    else s.totalLikes++;

    const st = results[v.key]?.status;
    if (st === 'success' || st === 'skipped') {
      s.cleaned++;
      if (isSel) selectedCleaned++;
    } else if (st === 'failed' || st === 'unverified') {
      s.failed++;
      if (isSel) selectedFailed++;
    } else if (st === 'unavailable' || v.isUnavailable) {
      s.unavailable++;
      if (isSel) selectedUnavailable++;
    }

    if (isSel) {
      s.totalSelected++;
      if (v.kind === 'repost') s.selectedReposts++;
      else s.selectedLikes++;
      if (isEligible(v, results)) s.eligibleSelected++;
    }
  }

  // Formula: Thành công + Thất bại + Còn lại = Tổng số được chọn ban đầu
  if (s.totalSelected > 0) {
    s.remaining = Math.max(0, s.totalSelected - selectedCleaned - selectedFailed - selectedUnavailable);
  } else {
    s.remaining = 0;
  }

  return s;
}
