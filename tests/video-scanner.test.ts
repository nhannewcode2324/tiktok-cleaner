import { describe, expect, it } from 'vitest';
import { parseCount, parseVideoHref } from '../src/shared/utils';
import { cleanDescription, extractItem, findGrid } from '../src/services/video-scanner';

describe('Video Scanner & DOM Parser', () => {
  it('parses valid video hrefs correctly', () => {
    const res1 = parseVideoHref('https://www.tiktok.com/@tiktok_star/video/7234567890123456789?is_from_webapp=1');
    expect(res1).not.toBeNull();
    expect(res1?.author).toBe('tiktok_star');
    expect(res1?.mediaType).toBe('video');
    expect(res1?.videoId).toBe('7234567890123456789');

    const res2 = parseVideoHref('/@photo_creator/photo/7987654321098765432');
    expect(res2?.author).toBe('photo_creator');
    expect(res2?.mediaType).toBe('photo');
    expect(res2?.videoId).toBe('7987654321098765432');

    expect(parseVideoHref('https://www.tiktok.com/@some_user')).toBeNull();
    expect(parseVideoHref('')).toBeNull();
  });

  it('parses count indicators into numeric views', () => {
    expect(parseCount('12.5K')).toBe(12500);
    expect(parseCount('1.2M')).toBe(1200000);
    expect(parseCount('985')).toBe(985);
    expect(parseCount('2,5B')).toBe(2500000000);
    expect(parseCount('invalid')).toBeNull();
  });

  it('cleans alt descriptions nicely', () => {
    const raw = 'Cute dance performance created by Jane Doe with original sound - Jane';
    const cleaned = cleanDescription(raw);
    expect(cleaned).toBe('Cute dance performance');
  });

  it('extracts item details accurately from DOM fixture', () => {
    const container = document.createElement('div');
    container.setAttribute('data-e2e', 'user-post-item');
    container.innerHTML = `
      <a href="https://www.tiktok.com/@cool_author/video/7112233445566778899" title="Amazing sunset timelapse">
        <img src="https://p16.tiktokcdn.com/thumb.webp" alt="Amazing sunset timelapse created by Cool Author with sound" />
      </a>
      <div data-e2e="video-views">45.2K</div>
    `;
    document.body.appendChild(container);

    const anchor = container.querySelector('a')!;
    const item = extractItem(anchor, 'like');

    expect(item).not.toBeNull();
    expect(item?.videoId).toBe('7112233445566778899');
    expect(item?.author).toBe('cool_author');
    expect(item?.kind).toBe('like');
    expect(item?.viewsText).toBe('45.2K');
    expect(item?.views).toBe(45200);
    expect(item?.thumbnail).toBe('https://p16.tiktokcdn.com/thumb.webp');
    expect(item?.description).toBe('Amazing sunset timelapse');

    document.body.removeChild(container);
  });

  it('normalizes video URLs to canonical https://www.tiktok.com origin to avoid redirect 403s', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <a href="/@author/video/9988776655443322111">
        <img src="https://p16.tiktokcdn.com/thumb.jpg" />
      </a>
    `;
    document.body.appendChild(container);
    const anchor = container.querySelector('a')!;
    const item = extractItem(anchor, 'repost');
    expect(item?.url).toBe('https://www.tiktok.com/@author/video/9988776655443322111');
    document.body.removeChild(container);
  });

  it('prevents cross-tab pollution between Repost and Like grids', () => {
    const repostGrid = document.createElement('div');
    repostGrid.setAttribute('data-e2e', 'user-repost-item-list');
    repostGrid.innerHTML = `
      <div data-e2e="user-post-item">
        <a href="https://tiktok.com/@author1/video/1111111111111111111"></a>
      </div>
    `;

    const likedGrid = document.createElement('div');
    likedGrid.setAttribute('data-e2e', 'user-liked-item-list');
    likedGrid.innerHTML = `
      <div data-e2e="user-post-item">
        <a href="https://tiktok.com/@author2/video/2222222222222222222"></a>
      </div>
    `;

    document.body.appendChild(repostGrid);
    document.body.appendChild(likedGrid);

    const repostAnchor = repostGrid.querySelector('a')!;
    const likedAnchor = likedGrid.querySelector('a')!;

    // When scanning Reposts, items from repostGrid are valid, but items from likedGrid are excluded
    expect(extractItem(repostAnchor, 'repost')).not.toBeNull();
    expect(extractItem(likedAnchor, 'repost')).toBeNull();

    // When scanning Likes, items from likedGrid are valid, but items from repostGrid are excluded
    expect(extractItem(likedAnchor, 'like')).not.toBeNull();
    expect(extractItem(repostAnchor, 'like')).toBeNull();

    document.body.removeChild(repostGrid);
    document.body.removeChild(likedGrid);
  });

  it('excludes user own original posts from reposts and self-likes', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <a href="https://tiktok.com/@nhansosad/video/3333333333333333333"></a>
    `;
    document.body.appendChild(container);
    const anchor = container.querySelector('a')!;

    // When logged-in as @nhansosad, a video authored by @nhansosad is their own post, so it must be excluded!
    expect(extractItem(anchor, 'repost', 'https://tiktok.com', 'nhansosad')).toBeNull();
    expect(extractItem(anchor, 'like', 'https://tiktok.com', 'nhansosad')).toBeNull();

    // But when authored by someone else, it is included!
    expect(extractItem(anchor, 'repost', 'https://tiktok.com', 'different_user')).not.toBeNull();
    expect(extractItem(anchor, 'like', 'https://tiktok.com', 'different_user')).not.toBeNull();

    document.body.removeChild(container);
  });

  it('findGrid never mistakes stale user-post-item-list for Liked or Repost grid during tab transition', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div role="tablist">
        <button role="tab" data-e2e="liked-tab" aria-selected="true">Đã thích</button>
      </div>
      <div role="tabpanel">
        <div data-e2e="user-post-item-list">
          <a href="https://www.tiktok.com/@me/video/1111111111111111111"></a>
        </div>
      </div>
    `;
    expect(findGrid(wrapper, 'like')).toBeNull();
    expect(findGrid(wrapper, 'repost')).toBeNull();

    // Once TikTok mounts the actual liked item list, findGrid resolves it properly
    const likedList = document.createElement('div');
    likedList.setAttribute('data-e2e', 'user-liked-item-list');
    wrapper.appendChild(likedList);
    expect(findGrid(wrapper, 'like')).toBe(likedList);
  });
});
