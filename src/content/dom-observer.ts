import { normalizeText } from '../shared/utils';

/**
 * DOM observer & page-state detection for tiktok.com.
 * Everything here only READS the page (no clicks) except `humanClick`/`hover`,
 * which dispatch ordinary user-equivalent events on elements we've verified.
 */

export function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el as HTMLElement).isConnected) return false;
  const h = el as HTMLElement;
  const style = h.ownerDocument.defaultView?.getComputedStyle(h);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
  // jsdom has no layout; treat zero-size as visible there.
  const r = h.getBoundingClientRect();
  const hasLayout = !(r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);
  if (!hasLayout) return !isRealBrowserLayout();
  return r.width > 0 && r.height > 0;
}

let layoutProbe: boolean | null = null;
function isRealBrowserLayout(): boolean {
  if (layoutProbe !== null) return layoutProbe;
  const body = document.body;
  layoutProbe = !!body && body.getBoundingClientRect().width > 0;
  return layoutProbe;
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

export function firstVisible<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return (qsa<T>(sel, root).find((e) => isVisible(e)) as T) ?? null;
}

export function clickableAncestor(el: Element): HTMLElement {
  return (el.closest('button, [role="button"], [role="menuitem"], [role="tab"], a, [tabindex]') as HTMLElement) ?? (el as HTMLElement);
}

export function hover(el: HTMLElement) {
  const opts = { bubbles: true, cancelable: true, view: window } as MouseEventInit;
  el.dispatchEvent(new PointerEvent('pointerover', opts));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
}

/** Click like a user would: scroll into view, hover, press, release, click. */
export function humanClick(el: HTMLElement) {
  try {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  } catch {
    /* ignore */
  }
  hover(el);
  const opts = { bubbles: true, cancelable: true, view: window, button: 0 } as MouseEventInit;
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

export function pressEscape() {
  const ev = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true } as KeyboardEventInit;
  document.dispatchEvent(new KeyboardEvent('keydown', ev));
  document.dispatchEvent(new KeyboardEvent('keyup', ev));
}

/**
 * Find visible elements whose own text matches. `exact` patterns must equal the
 * normalized text; `contains` patterns may appear anywhere in it.
 */
export function findByText(
  patterns: { exact?: string[]; contains?: string[] },
  root: ParentNode = document.body,
  maxLen = 60,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const seen = new Set<Element>();
  const doc = (root as Node).ownerDocument ?? document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue ?? '';
    if (!raw.trim() || raw.length > maxLen * 3) continue;
    const parent = node.parentElement;
    if (!parent || seen.has(parent)) continue;
    const t = normalizeText(parent.textContent);
    if (!t || t.length > maxLen) continue;
    const hit =
      (patterns.exact ?? []).some((p) => t === p) || (patterns.contains ?? []).some((p) => t.includes(p));
    if (hit && isVisible(parent)) {
      seen.add(parent);
      out.push(parent);
    }
  }
  return out;
}

// ------------------------------------------------------------------ account

export interface DetectedAccount {
  loggedIn: boolean;
  username: string | null;
  source: 'nav' | 'profile' | 'none';
}

const LOGIN_BUTTONS =
  '[data-e2e="top-login-button"], [data-e2e="nav-login-button"], #header-login-button, #top-right-action-bar-login-button, [data-e2e="login-button"]';
const LOGGED_IN_HINTS =
  '[data-e2e="profile-icon"], [data-e2e="inbox-icon"], [data-e2e="nav-profile"], [data-e2e="upload-icon"]';

const HANDLE_SHAPE = /^[a-z0-9_.]{1,24}$/i;

export function cleanHandle(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const h = raw.trim().replace(/^@+/, '').split(/[/?#&]/)[0];
  if (!h || !HANDLE_SHAPE.test(h)) return null;
  if (h.toLowerCase() === 'undefined' || h.toLowerCase() === 'null') return null;
  return h;
}

function usernameFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/@([^/?#]+)/);
  if (!m) return null;
  try {
    return cleanHandle(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

function detectFromHydration(doc: Document): string | null {
  const el = doc.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (el && el.textContent) {
    try {
      const data = JSON.parse(el.textContent);
      const defaultScope = data?.['__DEFAULT_SCOPE__'] || data;
      // IMPORTANT: Only read `webapp.app-context.user` (the signed-in user).
      // Never read `webapp.user-detail`, which is the currently viewed profile (may be a stranger).
      const appContext = defaultScope?.['webapp.app-context'] || defaultScope?.appContext;
      const user = appContext?.user;
      const handle = cleanHandle(user?.uniqueId);
      if (handle) return handle;
    } catch {
      /* ignore */
    }
  }

  const sigi = doc.getElementById('SIGI_STATE');
  if (sigi && sigi.textContent) {
    try {
      const data = JSON.parse(sigi.textContent);
      const uniqueId = cleanHandle(
        data?.AppContext?.appContext?.user?.uniqueId || data?.AppContext?.user?.uniqueId
      );
      if (uniqueId) return uniqueId;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function detectFromScripts(doc: Document): string | null {
  const scripts = qsa('script', doc);
  for (const s of scripts) {
    if (s.id === '__UNIVERSAL_DATA_FOR_REHYDRATION__' || s.id === 'SIGI_STATE') continue;
    const text = s.textContent || '';
    if (text.includes('appContext') && text.includes('uniqueId')) {
      const m = text.match(/"appContext"\s*:\s*\{[^{}]*"user"\s*:\s*\{[^{}]*"uniqueId"\s*:\s*"([a-zA-Z0-9_.]{1,24})"/);
      const handle = cleanHandle(m?.[1]);
      if (handle) return handle;
    }
  }
  return null;
}

export function detectAccount(doc: Document = document): DetectedAccount {
  // 1. Check Hydration JSON (signed-in app-context only)
  const fromHydration = detectFromHydration(doc);
  if (fromHydration) {
    return { loggedIn: true, username: fromHydration, source: 'nav' };
  }

  // 2. Check inline appContext scripts for signed-in user session
  const fromScripts = detectFromScripts(doc);
  if (fromScripts) {
    return { loggedIn: true, username: fromScripts, source: 'nav' };
  }

  // 3. Profile link in the navigation chrome (never inside main feed / video cards).
  const navLinks = qsa<HTMLAnchorElement>(
    'a[data-e2e="nav-profile"], [data-e2e="nav-profile"] a, a[data-e2e="profile-icon"], [data-e2e="profile-icon"] a, nav a[href*="/@"], header a[href*="/@"], [data-e2e*="sidebar"] a[href*="/@"]',
    doc,
  );
  for (const a of navLinks) {
    if (a.closest('main, [data-e2e*="recommend"], [data-e2e*="suggest"], [data-e2e*="following"]')) continue;
    const href = a.getAttribute('href');
    if (href && !href.includes('/video/') && !href.includes('/photo/') && !href.includes('/music/') && !href.includes('/tag/')) {
      const u = usernameFromHref(href);
      if (u) return { loggedIn: true, username: u, source: 'nav' };
    }
  }

  // 4. On our own profile page (verified via Edit Profile button)
  if (isOwnProfile(doc)) {
    const u = usernameFromHref(doc.location?.pathname);
    if (u) return { loggedIn: true, username: u, source: 'profile' };
  }

  const loginBtn = qsa(LOGIN_BUTTONS, doc).some((e) => isVisible(e));
  if (loginBtn) return { loggedIn: false, username: null, source: 'none' };
  const hints = doc.querySelector(LOGGED_IN_HINTS);
  return { loggedIn: !!hints, username: null, source: 'none' };
}

export function isOwnProfile(doc: Document = document): boolean {
  if (doc.querySelector('[data-e2e="edit-profile-entrance"], [data-e2e="edit-profile-button"]')) return true;
  const texts = ['edit profile', 'sua ho so', 'chinh sua ho so'];
  return qsa('button, [role="button"]', doc).some((b) => texts.includes(normalizeText(b.textContent)));
}

// ------------------------------------------------------------- blockers

const CAPTCHA_SELECTORS = [
  '#captcha-verify-container-main-page',
  '#captcha_container',
  '.captcha_verify_container',
  '.captcha-verify-container',
  '[class*="captcha_verify"]',
  '[class*="CaptchaVerify"]',
  'iframe[src*="captcha"]',
  '[id*="captcha"][role="dialog"]',
].join(',');

const CAPTCHA_TEXT = ['drag the slider', 'verify to continue', 'keo thanh truot', 'xac minh de tiep tuc', 'select 2 objects'];

export function detectCaptcha(doc: Document = document): boolean {
  if (qsa(CAPTCHA_SELECTORS, doc).some((e) => isVisible(e))) return true;
  const dialogs = qsa('[role="dialog"], [class*="modal" i]', doc).filter((d) => isVisible(d));
  return dialogs.some((d) => {
    const t = normalizeText(d.textContent).slice(0, 400);
    return CAPTCHA_TEXT.some((p) => t.includes(p));
  });
}

const RATE_LIMIT_TEXT = [
  'tapping too fast',
  'too many requests',
  'too many attempts',
  'try again later',
  'action blocked',
  'thao tac qua nhanh',
  'qua nhieu lan',
  'thu lai sau',
  'qua nhieu yeu cau',
];

export function toastTexts(doc: Document = document): string[] {
  return qsa('[role="alert"], [role="status"], [class*="toast" i], [class*="Toast"], [data-e2e*="toast"]', doc)
    .filter((e) => isVisible(e))
    .map((e) => normalizeText(e.textContent))
    .filter(Boolean);
}

export function detectRateLimit(doc: Document = document): boolean {
  return toastTexts(doc).some((t) => RATE_LIMIT_TEXT.some((p) => t.includes(p)));
}

const UNAVAILABLE_TEXT = [
  'video currently unavailable',
  'this video is unavailable',
  'video is unavailable',
  'post is unavailable',
  'video has been removed',
  'this video is private',
  "couldn't find this video",
  'couldnt find this video',
  'video hien khong kha dung',
  'video nay khong kha dung',
  'khong the xem video',
  'video da bi xoa',
  'bai dang khong kha dung',
];

export function detectUnavailable(doc: Document = document): boolean {
  const main = doc.querySelector('main, #main-content-video_detail, #app') ?? doc.body;
  const t = normalizeText(main?.textContent).slice(0, 20000);
  return UNAVAILABLE_TEXT.some((p) => t.includes(p));
}

export function detectOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function detectHttp403(doc: Document = document): boolean {
  const title = (doc.title || '').toLowerCase();
  if (title.includes('403 forbidden') || title.includes('access denied')) return true;
  const bodyText = (doc.body?.textContent || '').toLowerCase();
  if (
    bodyText.includes('http error 403') ||
    bodyText.includes('access to www.tiktok.com was denied') ||
    bodyText.includes("you don't have authorization to view this page") ||
    bodyText.includes('403 forbidden')
  ) {
    return true;
  }
  return false;
}

/** Resolves when the number of matching nodes grows, or after timeout. */
export function waitForGrowth(countFn: () => number, timeout: number, root: Node = document.body): Promise<boolean> {
  const start = countFn();
  return new Promise((resolve) => {
    let finished = false;
    const done = (v: boolean) => {
      if (finished) return;
      finished = true;
      obs.disconnect();
      clearTimeout(t);
      resolve(v);
    };
    const obs = new MutationObserver(() => {
      if (countFn() > start) done(true);
    });
    obs.observe(root, { childList: true, subtree: true });
    const t = setTimeout(() => done(countFn() > start), timeout);
  });
}
