import type { ActionResult } from '../shared/types';
import {
  clickableAncestor,
  detectCaptcha,
  detectHttp403,
  detectOffline,
  detectRateLimit,
  detectUnavailable,
  findByText,
  firstVisible,
  humanClick,
  isVisible,
  pressEscape,
} from './dom-observer';
import { SafetyStopError, UserAbortError, deleteRepostViaApi } from './tiktok-api';
import { verifyTransition } from '../services/result-verifier';
import { normalizeText, sleep } from '../shared/utils';
import { isActionAborted, sleepUnlessActionAborted } from './abort-signal';

/**
 * Repost Handler for TikTok Web.
 * Primary: Uses TikTok's authenticated first-party web endpoint
 * (`POST /tiktok/v1/upvote/delete?aid=1988&item_id=...`, per yiitxyz/tiktokRepostRemover)
 * with immediate safety stops on 401/403/429/CAPTCHA/rate-limits.
 * Secondary fallback: In-page video modal DOM interaction.
 */

const REPOST_BUTTON_SELECTORS = [
  '[data-e2e="browse-repost-icon"]',
  '[data-e2e="repost-button"]',
  '[data-e2e="repost-icon"]',
  'button[aria-label*="repost" i]',
  'button[aria-label*="đăng lại" i]',
  'button[title*="repost" i]',
  'button[title*="đăng lại" i]',
];

const SHARE_BUTTON_SELECTORS = [
  '[data-e2e="browse-share-icon"]',
  '[data-e2e="share-button"]',
  '[data-e2e="share-icon"]',
  'button[aria-label*="share" i]',
  'button[aria-label*="chia sẻ" i]',
];

function isRepostedState(el: Element): boolean {
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed === 'true') return true;
  const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
  if (label.includes('remove repost') || label.includes('go dang lai') || label.includes('da dang lai')) {
    return true;
  }
  // Check for yellow or active fill styling (TikTok Repost is distinctive yellow #FACE15 / rgb(250, 206, 21))
  const svg = el.querySelector('svg');
  if (svg) {
    const fill = svg.getAttribute('fill') || '';
    const style = window.getComputedStyle(svg);
    const color = style.color || style.fill || '';
    if (/face15|250,\s*206,\s*21/i.test(fill) || /face15|250,\s*206,\s*21/i.test(color)) {
      return true;
    }
  }
  return false;
}

export async function removeRepost(
  videoId: string,
  _targetUrl: string,
  options?: { domOnly?: boolean }
): Promise<ActionResult> {
  if (isActionAborted()) {
    return { status: 'failed', code: 'USER_ABORTED', message: 'Đã dừng theo yêu cầu người dùng.' };
  }

  if (detectOffline()) {
    return { status: 'failed', code: 'OFFLINE', message: 'Không có kết nối mạng', haltRun: true };
  }

  if (detectHttp403(document)) {
    return {
      status: 'failed',
      code: 'HTTP_403',
      message: 'TikTok từ chối truy cập (HTTP 403). Đã tạm dừng an toàn và lưu tiến độ.',
      haltRun: true,
    };
  }

  if (detectCaptcha()) {
    return { status: 'failed', code: 'CAPTCHA', message: 'Phát hiện CAPTCHA trên TikTok. Vui lòng hoàn tất xác minh.', haltRun: true };
  }

  if (detectRateLimit()) {
    return { status: 'failed', code: 'RATE_LIMIT', message: 'TikTok giới hạn tốc độ thao tác. Đã tạm dừng an toàn.', haltRun: true };
  }

  // Primary mechanism (from yiitxyz/tiktokRepostRemover):
  // Sequential first-party POST /tiktok/v1/upvote/delete?aid=1988&item_id=<videoId>
  if (!options?.domOnly) {
    try {
      await deleteRepostViaApi(videoId);
      return { status: 'success', code: 'SUCCESS', message: 'Đã xóa đăng lại thành công' };
    } catch (err) {
      if (err instanceof UserAbortError || isActionAborted()) {
        return { status: 'failed', code: 'USER_ABORTED', message: 'Đã dừng theo yêu cầu người dùng.' };
      }
      if (err instanceof SafetyStopError) {
        return {
          status: 'failed',
          code: err.code,
          message: err.message,
          haltRun: true,
        };
      }
      // If modal is not open, return clear API error so caller can decide whether to try DOM modal fallback
      const modalOpen = !!document.querySelector('[data-e2e="browse-video-container"], [data-e2e="browse-close"]');
      if (!modalOpen) {
        return {
          status: 'failed',
          code: 'API_REPOST_DELETE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  if (isActionAborted()) {
    return { status: 'failed', code: 'USER_ABORTED', message: 'Đã dừng theo yêu cầu người dùng.' };
  }

  if (detectUnavailable()) {
    return { status: 'unavailable', code: 'VIDEO_UNAVAILABLE', message: 'Video không khả dụng hoặc đã bị xóa' };
  }

  // 2. Try direct repost button first
  let repostBtn: HTMLElement | null = null;
  for (const sel of REPOST_BUTTON_SELECTORS) {
    const el = firstVisible(sel);
    if (el) {
      repostBtn = clickableAncestor(el);
      break;
    }
  }

  // 3. If direct button not visible, check inside the Share menu
  let openedShareMenu = false;
  if (!repostBtn) {
    for (const sel of SHARE_BUTTON_SELECTORS) {
      const shareBtn = firstVisible(sel);
      if (shareBtn) {
        humanClick(clickableAncestor(shareBtn));
        openedShareMenu = true;
        if (!(await sleepUnlessActionAborted(600))) {
          pressEscape();
          return { status: 'failed', code: 'USER_ABORTED', message: 'Đã dừng theo yêu cầu người dùng.' };
        }
        break;
      }
    }

    // Look for explicit remove repost option inside open menu
    const removeItems = findByText({
      contains: ['xoa dang lai', 'xóa đăng lại', 'go dang lai', 'gỡ đăng lại', 'remove repost', 'delete repost'],
    });
    for (const item of removeItems) {
      const ancestor = clickableAncestor(item);
      if (isVisible(ancestor)) {
        repostBtn = ancestor;
        break;
      }
    }

    // If no remove option found, check if it only has positive "repost" (means already un-reposted)
    if (!repostBtn) {
      const repostItems = findByText({
        contains: ['dang lai', 'đăng lại', 'repost'],
      });
      for (const item of repostItems) {
        const ancestor = clickableAncestor(item);
        if (isVisible(ancestor)) {
          // Found "Đăng lại" / "Repost" but NOT "Xóa đăng lại" => video is already not reposted!
          if (openedShareMenu) pressEscape();
          return {
            status: 'skipped',
            code: 'ALREADY_NOT_REPOSTED',
            message: 'Video đã không còn được đăng lại',
          };
        }
      }
    }
  }

  // 4. If no repost button could be located at all
  if (!repostBtn) {
    if (openedShareMenu) pressEscape();
    return {
      status: 'unavailable',
      code: 'REPOST_BUTTON_NOT_FOUND',
      message: 'TikTok web UI does not offer a Repost removal button for this video (use mobile app)',
    };
  }

  // 5. Determine if it is actually reposted right now
  const reposted = isRepostedState(repostBtn);
  const text = normalizeText(repostBtn.textContent || repostBtn.getAttribute('aria-label'));

  if (!reposted && (text.includes('repost') || text.includes('dang lai')) && !text.includes('remove') && !text.includes('go')) {
    // The button says "Repost" (not Remove Repost) and is not active => video is already un-reposted
    if (openedShareMenu) pressEscape();
    return {
      status: 'skipped',
      code: 'ALREADY_NOT_REPOSTED',
      message: 'Video is already not reposted',
    };
  }

  // 6. Click to remove repost
  if (isActionAborted()) {
    if (openedShareMenu) pressEscape();
    return { status: 'failed', code: 'USER_ABORTED', message: 'Đã dừng theo yêu cầu người dùng.' };
  }
  humanClick(repostBtn);

  // 7. Check if a confirmation dialog pops up (e.g., "Remove repost?")
  await sleep(400);
  const confirmBtns = findByText({
    exact: ['remove', 'gỡ', 'xóa', 'remove repost', 'gỡ đăng lại', 'xóa đăng lại', 'xác nhận'],
    contains: ['xóa đăng lại', 'gỡ đăng lại', 'remove repost', 'xác nhận'],
  });
  for (const cb of confirmBtns) {
    const cAncestor = clickableAncestor(cb);
    if (isVisible(cAncestor) && cAncestor !== repostBtn) {
      humanClick(cAncestor);
      break;
    }
  }

  // 8. Verify the result
  const verified = await verifyTransition(
    () => {
      if (detectCaptcha() || detectRateLimit()) return 'off';
      // If button now indicates un-reposted
      return isRepostedState(repostBtn!) ? 'on' : 'off';
    },
    'off',
    { timeout: 5000, settleMs: 800 }
  );

  if (openedShareMenu) {
    pressEscape();
  }

  if (detectCaptcha()) {
    return { status: 'failed', code: 'CAPTCHA', message: 'CAPTCHA detected during action', haltRun: true };
  }
  if (detectRateLimit()) {
    return { status: 'failed', code: 'RATE_LIMIT', message: 'Rate limit encountered after action', haltRun: true };
  }

  if (verified) {
    return { status: 'success', code: 'SUCCESS', message: 'Repost successfully removed' };
  }

  return {
    status: 'failed',
    code: 'VERIFY_FAILED',
    message: 'Could not verify repost removal on TikTok web',
  };
}
