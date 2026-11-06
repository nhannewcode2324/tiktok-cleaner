import { beforeEach, describe, expect, it } from 'vitest';
import {
  findLikeButton,
  inComments,
  isLiked,
  readLikeStateAgain,
  removeLike,
  verifyLikedViewerGuard,
} from '../src/content/like-handler';
import { detectAccount } from '../src/content/dom-observer';
import { performActionOnProfile } from '../src/content/index';

const FAST_TIMINGS = {
  buttonWaitMs: 120,
  hydrationWaitMs: 80,
  preClickDelayMs: 0,
  postClickDelayMs: 10,
  verifyTimeoutMs: 250,
  verifyPollMs: 25,
  settleConfirmMs: 25,
};

describe('Like Handler & DOM Safety (lefewix/tiktok-mass-unliker mechanisms)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    window.history.replaceState({}, '', '/@myhandle');
  });

  it('finds the video Like button in TikTok split desktop layout while ignoring comment hearts and like counts', () => {
    document.body.innerHTML = `
      <div id="main-content-video_detail">
        <div data-e2e="browse-video">
          <video src="blob:mock"></video>
        </div>
        <div class="DivActionBar">
          <button id="video-like-btn" type="button" aria-pressed="true">
            <span data-e2e="browse-like-icon">
              <svg><path fill="#FE2C55" d="M12 21z"></path></svg>
            </span>
            <strong data-e2e="browse-like-count">128.4K</strong>
          </button>
        </div>
        <div data-e2e="comment-list" class="DivCommentListContainer">
          <div class="DivCommentItemContainer">
            <button id="comment-like-btn" type="button" aria-label="Like comment" aria-pressed="false">
              <span data-e2e="comment-like-icon"><svg><path d="M1 1"></path></svg></span>
            </button>
          </div>
        </div>
      </div>
    `;

    const found = findLikeButton();
    expect(found).not.toBeNull();
    expect(found?.id).toBe('video-like-btn');
    expect(inComments(document.getElementById('comment-like-btn'))).toBe(true);
  });

  it('returns null when only comment hearts or background page nodes exist outside an active viewer container', () => {
    document.body.innerHTML = `
      <main>
        <button id="stray-btn" aria-label="Like video" aria-pressed="true"></button>
      </main>
    `;
    expect(findLikeButton()).toBeNull();

    document.body.innerHTML = `
      <div id="main-content-video_detail">
        <div data-e2e="browse-like-count">99K</div>
        <div class="DivCommentContainer">
          <button aria-label="Like" aria-pressed="true"></button>
        </div>
      </div>
    `;
    expect(findLikeButton()).toBeNull();
  });

  it('accurately evaluates tri-state isLiked across aria-pressed, adversarial aria-label, and strict SVG red fill', () => {
    // 1. aria-pressed takes priority
    const pressedTrue = document.createElement('button');
    pressedTrue.setAttribute('aria-pressed', 'true');
    expect(isLiked(pressedTrue)).toBe(true);

    const pressedFalse = document.createElement('button');
    pressedFalse.setAttribute('aria-pressed', 'false');
    expect(isLiked(pressedFalse)).toBe(false);

    // 2. Adversarial social-proof aria-label ("Like video, liked by 1.2M" -> MUST be false, NOT true!)
    const socialProofUnliked = document.createElement('button');
    socialProofUnliked.setAttribute('aria-label', 'Like video, liked by 1.2M users');
    expect(isLiked(socialProofUnliked)).toBe(false);

    const unlikeLabel = document.createElement('button');
    unlikeLabel.setAttribute('aria-label', 'Unlike video');
    expect(isLiked(unlikeLabel)).toBe(true);

    const viLikedLabel = document.createElement('button');
    viLikedLabel.setAttribute('aria-label', 'Bỏ thích video');
    expect(isLiked(viLikedLabel)).toBe(true);

    // 3. Strict TikTok red (#fe2c55 / rgb(254, 44, 85)) vs near-white rgba(254, 254, 254, 1)
    const redHeart = document.createElement('button');
    redHeart.innerHTML = `<span data-e2e="browse-like-icon"><svg><path fill="rgb(254, 44, 85)"></path></svg></span>`;
    expect(isLiked(redHeart)).toBe(true);

    const nearWhiteHeart = document.createElement('button');
    nearWhiteHeart.innerHTML = `<span data-e2e="browse-like-icon"><svg><path fill="rgba(254, 254, 254, 1)"></path></svg></span>`;
    expect(isLiked(nearWhiteHeart)).toBe(false);

    // 4. Unhydrated / ambiguous button with no aria-pressed, no label, and no fill -> null
    const ambiguous = document.createElement('button');
    ambiguous.innerHTML = `<svg><path d="M12 21z"></path></svg>`;
    expect(isLiked(ambiguous)).toBeNull();
  });

  it('enforces viewer guards: vetoes For You feed & videoId mismatch, while allowing creator handle in URL', () => {
    // Creator handle (@other_creator) in modal URL is normal for liked videos and MUST be allowed
    window.history.replaceState({}, '', '/@other_creator/video/7400000000000000123');
    document.body.innerHTML = `<div data-e2e="browse-video-container"></div>`;
    expect(verifyLikedViewerGuard('7400000000000000123', document).ok).toBe(true);

    // Different videoId in URL -> veto
    const mismatch = verifyLikedViewerGuard('7400000000000000999', document);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe('VIDEO_ID_MISMATCH');

    // For You feed container -> haltRun veto
    document.body.innerHTML = `<div data-e2e="recommend-list-item-container"></div>`;
    const feedGuard = verifyLikedViewerGuard('7400000000000000123', document);
    expect(feedGuard.ok).toBe(false);
    expect(feedGuard.code).toBe('WRONG_FEED_GUARD');
    expect(feedGuard.haltRun).toBe(true);
  });

  it('clicks liked button ONCE, survives React replacing the button DOM node, and verifies unliked state', async () => {
    window.history.replaceState({}, '', '/@creator_xyz/video/7411111111111111111');
    document.body.innerHTML = `
      <div id="main-content-video_detail">
        <div data-e2e="browse-video"><video></video></div>
        <div id="rail">
          <button id="like-btn-v1" type="button" aria-pressed="true">
            <span data-e2e="browse-like-icon"><svg><path fill="#FE2C55"></path></svg></span>
          </button>
        </div>
      </div>
    `;

    let clickCount = 0;
    const v1 = document.getElementById('like-btn-v1')!;
    v1.addEventListener('click', () => {
      clickCount += 1;
      // Simulate React replacing the entire <button> node on state transition
      const rail = document.getElementById('rail')!;
      rail.innerHTML = `
        <button id="like-btn-v2" type="button" aria-pressed="false">
          <span data-e2e="browse-like-icon"><svg><path fill="rgba(255, 255, 255, 0.9)"></path></svg></span>
        </button>
      `;
    });

    const res = await removeLike(
      '7411111111111111111',
      'https://www.tiktok.com/@creator_xyz/video/7411111111111111111',
      FAST_TIMINGS
    );

    expect(clickCount).toBe(1);
    expect(res.status).toBe('success');
    expect(res.code).toBe('SUCCESS');
    expect(readLikeStateAgain(v1)).toBe(false);
  });

  it('never clicks when video is already unliked or when DOM state is indeterminate', async () => {
    window.history.replaceState({}, '', '/@creator_xyz/video/7422222222222222222');
    document.body.innerHTML = `
      <div data-e2e="browse-video-container">
        <button id="already-unliked" type="button" aria-pressed="false">
          <span data-e2e="browse-like-icon"></span>
        </button>
      </div>
    `;
    let clicks = 0;
    document.getElementById('already-unliked')!.addEventListener('click', () => {
      clicks += 1;
    });

    const skipRes = await removeLike('7422222222222222222', 'https://www.tiktok.com', FAST_TIMINGS);
    expect(clicks).toBe(0);
    expect(skipRes.status).toBe('skipped');
    expect(skipRes.code).toBe('ALREADY_UNLIKED');
    expect(skipRes.skipReason).toContain('CONFIRMED_ALREADY_UNLIKED');
    expect(skipRes.trace).toEqual([
      'OPENING',
      'WAITING_FOR_VIDEO',
      'WAITING_FOR_LIKE_BUTTON',
      'CHECKING_LIKE',
      'SKIPPED',
    ]);

    // Indeterminate button (no aria-pressed, no label, no SVG fill) -> MUST be UNVERIFIED, NEVER SKIPPED!
    document.body.innerHTML = `
      <div data-e2e="browse-video-container">
        <button id="indeterminate-btn" type="button">
          <span data-e2e="browse-like-icon"><svg><path d="M0 0"></path></svg></span>
        </button>
      </div>
    `;
    document.getElementById('indeterminate-btn')!.addEventListener('click', () => {
      clicks += 1;
    });

    const indetRes = await removeLike('7422222222222222222', 'https://www.tiktok.com', FAST_TIMINGS);
    expect(clicks).toBe(0);
    expect(indetRes.status).toBe('unverified');
    expect(indetRes.stage).toBe('UNVERIFIED');
    expect(indetRes.code).toBe('INDETERMINATE_LIKE_STATE');
    expect(indetRes.trace).toEqual([
      'OPENING',
      'WAITING_FOR_VIDEO',
      'WAITING_FOR_LIKE_BUTTON',
      'CHECKING_LIKE',
      'UNVERIFIED',
    ]);
  });

  it('DOES NOT prematurely mark SKIPPED when Like button initially mounts as unliked (false) and hydrates to liked (true) late', async () => {
    window.history.replaceState({}, '', '/@creator_xyz/video/7444444444444444444');
    // TikTok modal mounts shell with default unliked heart (`aria-pressed="false"`) before item state hydrates
    document.body.innerHTML = `
      <div data-e2e="browse-video-container">
        <video src="https://v16.tiktokcdn.com/slow-stream.mp4" data-loading="true"></video>
        <button id="hydrating-like-btn" type="button" aria-pressed="false">
          <span data-e2e="browse-like-icon"><svg><path fill="rgba(255, 255, 255, 0.9)"></path></svg></span>
        </button>
      </div>
    `;

    const btn = document.getElementById('hydrating-like-btn')!;
    const vid = document.querySelector('video')!;
    let clicks = 0;

    btn.addEventListener('click', () => {
      clicks += 1;
      // After real click, TikTok updates button to unliked after 40ms network roundtrip
      setTimeout(() => {
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = `<span data-e2e="browse-like-icon"><svg><path fill="rgba(255, 255, 255, 0.9)"></path></svg></span>`;
      }, 40);
    });

    // Simulate slow video hydration: 110ms after modal opens, video finishes loading & TikTok hydrates `digged: true`
    setTimeout(() => {
      vid.removeAttribute('data-loading');
      vid.dispatchEvent(new Event('loadeddata'));
      btn.setAttribute('aria-pressed', 'true');
      btn.innerHTML = `<span data-e2e="browse-like-icon"><svg><path fill="#FE2C55"></path></svg></span>`;
    }, 110);

    const res = await removeLike('7444444444444444444', 'https://www.tiktok.com', {
      videoReadyWaitMs: 300,
      buttonWaitMs: 400,
      hydrationWaitMs: 350,
      unlikedConfirmWaitMs: 300,
      preClickDelayMs: 10,
      postClickDelayMs: 10,
      verifyTimeoutMs: 400,
      verifyPollMs: 25,
      settleConfirmMs: 30,
    });

    expect(clicks).toBe(1);
    expect(res.status).toBe('success');
    expect(res.stage).toBe('SUCCESS');
    expect(res.trace).toEqual([
      'OPENING',
      'WAITING_FOR_VIDEO',
      'WAITING_FOR_LIKE_BUTTON',
      'CHECKING_LIKE',
      'UNLIKING',
      'VERIFYING',
      'SUCCESS',
    ]);
  });

  it('waits via MutationObserver when DOM/video is unready and Like button appears late, never skipping early', async () => {
    // Initially DOM is completely unready (modal not mounted yet, URL still transitioning from previous video)
    window.history.replaceState({}, '', '/@creator_prev/video/7000000000000000001');
    document.body.innerHTML = `<main id="profile-shell"></main>`;

    let clicks = 0;

    // Step 1 (60ms): SPA route & video container mount, but Like button is NOT rendered yet
    setTimeout(() => {
      window.history.replaceState({}, '', '/@creator_xyz/video/7455555555555555555');
      document.body.innerHTML = `
        <div id="main-content-video_detail">
          <div data-e2e="browse-video"><video src="https://v16.tiktokcdn.com/v2.mp4" data-loading="true"></video></div>
          <div id="action-rail"></div>
        </div>
      `;
    }, 60);

    // Step 2 (160ms): Video metadata loads & Like button finally mounts in the action rail
    setTimeout(() => {
      const vid = document.querySelector('video');
      vid?.removeAttribute('data-loading');
      vid?.dispatchEvent(new Event('loadedmetadata'));

      const rail = document.getElementById('action-rail')!;
      rail.innerHTML = `
        <button id="late-like-btn" type="button" aria-pressed="true">
          <span data-e2e="browse-like-icon"><svg><path fill="#FE2C55"></path></svg></span>
        </button>
      `;
      const lateBtn = document.getElementById('late-like-btn')!;
      lateBtn.addEventListener('click', () => {
        clicks += 1;
        setTimeout(() => {
          lateBtn.setAttribute('aria-pressed', 'false');
        }, 25);
      });
    }, 160);

    const res = await removeLike('7455555555555555555', 'https://www.tiktok.com', {
      videoReadyWaitMs: 350,
      buttonWaitMs: 500,
      buttonMaxRetries: 4,
      hydrationWaitMs: 300,
      preClickDelayMs: 10,
      postClickDelayMs: 10,
      verifyTimeoutMs: 400,
      verifyPollMs: 25,
      settleConfirmMs: 30,
    });

    expect(clicks).toBe(1);
    expect(res.status).toBe('success');
    expect(res.stage).toBe('SUCCESS');
    expect(res.trace).toEqual([
      'OPENING',
      'WAITING_FOR_VIDEO',
      'WAITING_FOR_LIKE_BUTTON',
      'CHECKING_LIKE',
      'UNLIKING',
      'VERIFYING',
      'SUCCESS',
    ]);
  });

  it('marks UNVERIFIED (never SKIPPED) when Like button never appears after bounded retries', async () => {
    window.history.replaceState({}, '', '/@creator_xyz/video/7466666666666666666');
    document.body.innerHTML = `
      <div data-e2e="browse-video-container">
        <video></video>
        <div class="empty-action-bar"></div>
      </div>
    `;

    const res = await removeLike('7466666666666666666', 'https://www.tiktok.com', {
      videoReadyWaitMs: 60,
      buttonWaitMs: 150,
      buttonMaxRetries: 3,
    });

    expect(res.status).toBe('unverified');
    expect(res.stage).toBe('UNVERIFIED');
    expect(res.code).toBe('LIKE_BUTTON_NOT_FOUND');
    expect(res.trace).toEqual([
      'OPENING',
      'WAITING_FOR_VIDEO',
      'WAITING_FOR_LIKE_BUTTON',
      'UNVERIFIED',
    ]);
  });

  it('prevents concurrent duplicate clicks on the same videoId', async () => {
    window.history.replaceState({}, '', '/@creator_xyz/video/7477777777777777777');
    document.body.innerHTML = `
      <div data-e2e="browse-video-container">
        <button id="dup-guard-btn" type="button" aria-pressed="true">
          <span data-e2e="browse-like-icon"></span>
        </button>
      </div>
    `;

    let clicks = 0;
    const btn = document.getElementById('dup-guard-btn')!;
    btn.addEventListener('click', () => {
      clicks += 1;
      btn.setAttribute('aria-pressed', 'false');
    });

    const [first, duplicate] = await Promise.all([
      removeLike('7477777777777777777', 'https://www.tiktok.com', {
        ...FAST_TIMINGS,
        preClickDelayMs: 40,
      }),
      removeLike('7477777777777777777', 'https://www.tiktok.com', FAST_TIMINGS),
    ]);

    expect(clicks).toBe(1);
    expect(first.status).toBe('success');
    expect(duplicate.status).toBe('unverified');
    expect(duplicate.code).toBe('DUPLICATE_IN_FLIGHT');
  });

  it('performActionOnProfile returns UNVERIFIED (CARD_NOT_FOUND_ON_GRID) instead of SKIPPED when card is absent from profile grid', async () => {
    window.history.replaceState({}, '', '/@myhandle');
    document.body.innerHTML = `
      <div role="tablist">
        <button role="tab" data-e2e="liked-tab" aria-selected="true">Đã thích</button>
      </div>
      <div data-e2e="user-liked-item-list">
        <a href="https://www.tiktok.com/@other/video/7100000000000000001"></a>
      </div>
    `;

    const res = await performActionOnProfile(
      'remove_like',
      '7999999999999999999',
      'myhandle',
      'https://www.tiktok.com/@creator/video/7999999999999999999',
      { maxScrolls: 0 }
    );

    expect(res.status).toBe('unverified');
    expect(res.code).toBe('CARD_NOT_FOUND_ON_GRID');
    expect(res.trace).toEqual(['OPENING', 'UNVERIFIED']);
  });

  it('catches optimistic UI rollback without clicking a second time', async () => {
    window.history.replaceState({}, '', '/@creator_xyz/video/7433333333333333333');
    document.body.innerHTML = `
      <div data-e2e="browse-video-container">
        <button id="rollback-btn" type="button" aria-pressed="true">
          <span data-e2e="browse-like-icon"></span>
        </button>
      </div>
    `;

    let clicks = 0;
    const btn = document.getElementById('rollback-btn')!;
    btn.addEventListener('click', () => {
      clicks += 1;
      // Optimistically flips to false, then TikTok silently rolls it back to true 15ms later
      btn.setAttribute('aria-pressed', 'false');
      setTimeout(() => {
        btn.setAttribute('aria-pressed', 'true');
      }, 15);
    });

    const res = await removeLike('7433333333333333333', 'https://www.tiktok.com', {
      ...FAST_TIMINGS,
      settleConfirmMs: 40,
      verifyTimeoutMs: 140,
    });

    expect(clicks).toBe(1);
    expect(res.status).toBe('failed');
    expect(res.code).toBe('VERIFY_FAILED');
  });

  it('detectAccount ignores stranger profile hydration (`webapp.user-detail`) when logged out', () => {
    const hydration = document.createElement('script');
    hydration.id = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
    hydration.type = 'application/json';
    hydration.textContent = JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.app-context': { user: null },
        'webapp.user-detail': { userInfo: { user: { uniqueId: 'stranger_celebrity' } } },
      },
    });
    document.body.appendChild(hydration);

    const loginBtn = document.createElement('button');
    loginBtn.setAttribute('data-e2e', 'top-login-button');
    document.body.appendChild(loginBtn);

    const detected = detectAccount(document);
    expect(detected.loggedIn).toBe(false);
    expect(detected.username).toBeNull();
  });
});
