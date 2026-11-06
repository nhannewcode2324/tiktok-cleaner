import type { MediaType, VideoKind } from '../shared/types';
import { parseCount, parseVideoHref } from '../shared/utils';

/**
 * Video Scanner — DOM extraction helpers. Pure DOM (no chrome APIs) so it can be
 * tested against sample HTML with jsdom. Selectors are layered: stable `data-e2e`
 * hooks first, generic structural fallbacks second.
 */

export interface RawVideoItem {
  videoId: string;
  kind: VideoKind;
  mediaType: MediaType;
  url: string;
  author: string;
  description: string;
  thumbnail: string | null;
  viewsText: string | null;
  views: number | null;
  isUnavailable?: boolean;
}

export const GRID_SELECTORS: Record<VideoKind, string[]> = {
  repost: [
    '[data-e2e="user-repost-item-list"]',
    '[data-e2e*="repost-item-list"]',
    '[data-e2e*="repost-list"]',
    'div[data-e2e*="repost"] [data-e2e*="item-list"]',
  ],
  like: [
    '[data-e2e="user-liked-item-list"]',
    '[data-e2e*="liked-item-list"]',
    '[data-e2e*="like-list"]',
    'div[data-e2e*="liked"] [data-e2e*="item-list"]',
  ],
};

export function detectItemUnavailable(container: Element): boolean {
  const text = (container.textContent || '').toLowerCase();
  const unavailPatterns = [
    'unavailable',
    'không khả dụng',
    'khong kha dung',
    'has been removed',
    'đã bị xóa',
    'da bi xoa',
    'this video is private',
    'video này là riêng tư',
    'riêng tư',
    'rieng tu',
    'bị ẩn',
    'bi an',
  ];
  if (unavailPatterns.some((p) => text.includes(p))) return true;

  if (container.querySelector('[data-e2e*="unavailable"], [class*="unavailable" i], [class*="private" i], [class*="deleted" i]')) {
    return true;
  }
  return false;
}

const ITEM_CONTAINER = '[data-e2e="user-post-item"], [data-e2e="user-liked-item"], [data-e2e="user-repost-item"], [data-e2e$="-item"]';
const EXCLUDE_ANCESTORS = 'header, nav, aside, [data-e2e="recommend-list"], [data-e2e*="comment"]';

function isUsableUrl(u: string | null | undefined): u is string {
  if (!u) return false;
  const s = u.trim();
  return /^https?:\/\//i.test(s) && !/^data:/i.test(s);
}

function firstFromSrcset(srcset: string | null | undefined): string | null {
  if (!srcset) return null;
  const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
  return isUsableUrl(first) ? first : null;
}

export function pickThumbnail(container: Element): string | null {
  const imgs = Array.from(container.querySelectorAll('img'));
  for (const img of imgs) {
    const cands = [
      (img as HTMLImageElement).currentSrc,
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      firstFromSrcset(img.getAttribute('srcset')),
    ];
    for (const c of cands) if (isUsableUrl(c)) return c.trim();
  }
  const source = container.querySelector('picture source[srcset]');
  const fromSource = firstFromSrcset(source?.getAttribute('srcset'));
  if (fromSource) return fromSource;
  // Fallback: CSS background-image on a descendant.
  const withBg = Array.from(container.querySelectorAll<HTMLElement>('[style*="background-image"]'));
  for (const el of withBg) {
    const m = el.getAttribute('style')?.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
    if (m && isUsableUrl(m[2])) return m[2];
  }
  return null;
}

export function cleanDescription(text: string | null | undefined): string {
  if (!text) return '';
  let t = text.replace(/\s+/g, ' ').trim();
  // TikTok alt texts often end with "created by <name> with <sound>".
  t = t.replace(/\s+created by .+? with .+$/i, '').trim();
  return t.length > 300 ? t.slice(0, 297) + '…' : t;
}

export function findGrid(root: ParentNode, kind: VideoKind): Element | null {
  for (const sel of GRID_SELECTORS[kind]) {
    const el = root.querySelector(sel);
    if (el) return el;
  }

  // Check tabpanel matching kind
  const panel = root.querySelector(`[role="tabpanel"][data-e2e*="${kind}" i], [role="tabpanel"][aria-labelledby*="${kind}" i], [role="tabpanel"][id*="${kind}" i]`);
  if (panel) return panel;

  // If the active tab button explicitly corresponds to this kind, return the active visible list
  const activeTab = root.querySelector(`[role="tab"][aria-selected="true"], [data-e2e*="${kind}-tab"][aria-selected="true"], [data-e2e*="${kind}-tab"].active, [data-active="true"]`);
  if (activeTab) {
    const tabText = (activeTab.textContent || activeTab.getAttribute('data-e2e') || '').toLowerCase();
    const isTargetTab = kind === 'repost'
      ? /repost|dang lai|đăng lại/i.test(tabText)
      : (/liked|da thich|đã thích/i.test(tabText) && !/yeu thich|yêu thích|favorite/i.test(tabText));

    if (isTargetTab) {
      // Never match `[data-e2e="user-post-item-list"]` (user's own Posts tab) or the opposite tab's list!
      // When switching to Reposts/Liked, TikTok updates `aria-selected="true"` on the tab button BEFORE
      // unmounting `user-post-item-list`, which previously caused false-positive empty/wrong grid lookups.
      const oppositeE2e = kind === 'repost' ? 'user-liked-item-list' : 'user-repost-item-list';
      const lists = Array.from(root.querySelectorAll('[data-e2e*="item-list"]'));
      for (const el of lists) {
        const e2e = (el.getAttribute('data-e2e') || '').toLowerCase();
        if (e2e === 'user-post-item-list' || e2e === oppositeE2e) continue;
        return el;
      }
      const panels = Array.from(root.querySelectorAll('[role="tabpanel"]'));
      for (const panelEl of panels) {
        if (panelEl.querySelector('[data-e2e="user-post-item-list"]')) continue;
        if (panelEl.querySelector(`[data-e2e="${oppositeE2e}"]`)) continue;
        return panelEl;
      }
    }
  }

  return null;
}

export function findVideoAnchors(scope: ParentNode): HTMLAnchorElement[] {
  const anchors = Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"], a[href*="/photo/"]'));
  return anchors.filter((a) => !a.closest(EXCLUDE_ANCESTORS) && parseVideoHref(a.getAttribute('href')));
}

export function extractItem(
  anchor: HTMLAnchorElement,
  kind: VideoKind,
  origin = 'https://www.tiktok.com',
  loggedInUser?: string | null
): RawVideoItem | null {
  const href = anchor.getAttribute('href');
  const parsed = parseVideoHref(href);
  if (!parsed) return null;

  // Cross-tab pollution protection:
  // Only exclude if anchor is explicitly located inside an OPPOSITE active grid
  if (kind === 'repost' && anchor.closest('[data-e2e="user-liked-item-list"]')) {
    return null;
  }
  if (kind === 'like' && anchor.closest('[data-e2e="user-repost-item-list"]')) {
    return null;
  }

  // Filter out the user's own original posts:
  // Reposts should only count other creators' videos that were reposted, not own videos!
  // Self-likes on own posts and user's own private videos are also excluded from cleanup scope.
  if (loggedInUser) {
    try {
      const cleanUser = decodeURIComponent(loggedInUser).replace(/^@/, '').toLowerCase().trim();
      const cleanAuthor = decodeURIComponent(parsed.author || '').replace(/^@/, '').toLowerCase().trim();
      if (cleanUser && cleanAuthor === cleanUser) {
        return null;
      }
    } catch {
      const cleanUser = loggedInUser.replace(/^@/, '').toLowerCase().trim();
      const cleanAuthor = (parsed.author || '').replace(/^@/, '').toLowerCase().trim();
      if (cleanUser && cleanAuthor === cleanUser) {
        return null;
      }
    }
  }

  const container = anchor.closest(ITEM_CONTAINER) ?? anchor.parentElement ?? anchor;

  // Exclude private posts if they belong to own account or are private self-likes
  const isPrivateLock = !!container.querySelector('[data-e2e*="private"], [data-e2e*="lock"], [aria-label*="riêng tư" i], [aria-label*="private" i], [class*="lock" i]');
  if (isPrivateLock && loggedInUser) {
    try {
      const cleanUser = decodeURIComponent(loggedInUser).replace(/^@/, '').toLowerCase().trim();
      const cleanAuthor = decodeURIComponent(parsed.author || '').replace(/^@/, '').toLowerCase().trim();
      if (cleanUser && cleanAuthor === cleanUser) {
        return null;
      }
    } catch {
      /* ignore */
    }
  }
  const img = container.querySelector('img');
  const descEl = container.querySelector('[data-e2e*="desc"]');
  const viewsEl = container.querySelector('[data-e2e="video-views"]');
  const viewsText = viewsEl?.textContent?.trim() || null;
  let url: string;
  try {
    const u = new URL(href!, origin);
    url = `${u.origin}${u.pathname}`;
  } catch {
    url = `${origin}/@${parsed.author}/${parsed.mediaType}/${parsed.videoId}`;
  }
  const isUnavailable = detectItemUnavailable(container);
  return {
    videoId: parsed.videoId,
    kind,
    mediaType: parsed.mediaType,
    url,
    author: parsed.author,
    description: cleanDescription(img?.getAttribute('alt') || anchor.getAttribute('title') || descEl?.textContent || ''),
    thumbnail: pickThumbnail(container),
    viewsText,
    views: parseCount(viewsText),
    isUnavailable,
  };
}

/** Extract all unique items from a scope; later duplicates only fill missing fields. */
export function extractAll(
  scope: ParentNode,
  kind: VideoKind,
  origin?: string,
  loggedInUser?: string | null
): RawVideoItem[] {
  const map = new Map<string, RawVideoItem>();
  for (const a of findVideoAnchors(scope)) {
    const item = extractItem(a, kind, origin, loggedInUser);
    if (!item) continue;
    const prev = map.get(item.videoId);
    if (!prev) map.set(item.videoId, item);
    else map.set(item.videoId, mergeItem(prev, item));
  }
  return [...map.values()];
}

export function mergeItem<T extends RawVideoItem>(prev: T, next: RawVideoItem): T {
  return {
    ...prev,
    thumbnail: next.thumbnail || prev.thumbnail,
    description: prev.description || next.description,
    viewsText: next.viewsText ?? prev.viewsText,
    views: next.views ?? prev.views,
    isUnavailable: next.isUnavailable || prev.isUnavailable,
  };
}
