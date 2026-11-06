import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  language: 'vi',
  theme: 'dark',
  actionDelay: 2,
  maxItemsPerRun: 2000,
  retryLimit: 1,
  stopOnConsecutiveErrors: 5,
  confirmBeforeCleanup: true,
  scanLimit: 2000,
};

/** Safe ranges enforced on every settings write (cannot be bypassed from UI). */
export const SETTINGS_LIMITS = {
  actionDelay: { min: 1, max: 30 },
  maxItemsPerRun: { min: 1, max: 5000 },
  retryLimit: { min: 0, max: 3 },
  stopOnConsecutiveErrors: { min: 1, max: 20 },
  scanLimit: { min: 20, max: 10000 },
} as const;

export const TIKTOK_ORIGIN = 'https://www.tiktok.com';
export const TIKTOK_MATCH_PATTERNS = ['https://www.tiktok.com/*', 'https://tiktok.com/*', 'https://*.tiktok.com/*'];

export const LOG_LIMIT = 3000;
export const HISTORY_LIMIT = 100;

/** Error codes that halt the whole run instead of failing a single job. */
export const HALT_CODES = new Set([
  'CAPTCHA',
  'RATE_LIMIT',
  'NOT_LOGGED_IN',
  'ACCOUNT_MISMATCH',
  'TAB_CLOSED',
  'OFFLINE',
  'HTTP_401',
  'HTTP_403',
  'HTTP_429',
  'ACCESS_DENIED',
  'SAFETY_STOP',
  'WRONG_FEED_GUARD',
  'LIKED_TAB_DESELECTED',
  'VERIFY_STREAK',
  'VERIFY_WINDOW',
  'VERIFY_CEILING',
  'INDETERMINATE_DOM',
]);

export function clampSettings(input: Partial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  const s: Settings = { ...base, ...input, confirmBeforeCleanup: true };
  const clamp = (v: unknown, k: keyof typeof SETTINGS_LIMITS, fallback: number) => {
    const n = Number(v);
    const { min, max } = SETTINGS_LIMITS[k];
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  s.actionDelay = clamp(s.actionDelay, 'actionDelay', base.actionDelay);
  s.maxItemsPerRun = clamp(s.maxItemsPerRun, 'maxItemsPerRun', base.maxItemsPerRun);
  s.retryLimit = clamp(s.retryLimit, 'retryLimit', base.retryLimit);
  s.stopOnConsecutiveErrors = clamp(s.stopOnConsecutiveErrors, 'stopOnConsecutiveErrors', base.stopOnConsecutiveErrors);
  s.scanLimit = clamp(s.scanLimit, 'scanLimit', base.scanLimit);
  if (s.language !== 'en' && s.language !== 'vi') s.language = base.language;
  if (s.theme !== 'dark' && s.theme !== 'light') s.theme = base.theme;
  return s;
}
