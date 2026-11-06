import type {
  AccountInfo,
  HistoryEntry,
  LogEntry,
  QueueState,
  ResultRecord,
  ScanState,
  ScannedVideo,
  Settings,
} from '../shared/types';
import { DEFAULT_SETTINGS, HISTORY_LIMIT, LOG_LIMIT, clampSettings } from '../shared/constants';
import { emptyQueue } from './automation-queue';
import { uid } from '../shared/utils';

/**
 * Storage Manager — thin typed wrapper around chrome.storage.local.
 * Per-account data is namespaced so a different TikTok account never sees
 * (or processes) another account's lists.
 */

export const K = {
  settings: 'settings',
  uiPrefs: 'uiPrefs',
  account: 'account',
  queue: 'queue',
  scan: 'scan',
  log: 'log',
  history: 'history',
  videos: (acct: string) => `videos:${acct.toLowerCase()}`,
  selection: (acct: string) => `selection:${acct.toLowerCase()}`,
  results: (acct: string) => `results:${acct.toLowerCase()}`,
} as const;

export interface UiPrefs {
  filter: string;
  sort: string;
}

export const emptyScan = (): ScanState => ({
  status: 'idle',
  account: null,
  kinds: [],
  currentKind: null,
  found: 0,
  newFound: 0,
  message: null,
  code: null,
  startedAt: null,
  finishedAt: null,
});

async function get<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export const storage = {
  get,
  set,

  async getSettings(): Promise<Settings> {
    return clampSettings(await get<Partial<Settings>>(K.settings, DEFAULT_SETTINGS));
  },
  async saveSettings(s: Partial<Settings>): Promise<Settings> {
    const cur = await storage.getSettings();
    const next = clampSettings({ ...cur, ...s });
    await set(K.settings, next);
    return next;
  },

  getAccount: () => get<AccountInfo | null>(K.account, null),
  setAccount: (a: AccountInfo) => set(K.account, a),

  getUiPrefs: async (): Promise<UiPrefs> => {
    const raw = await get<Partial<UiPrefs>>(K.uiPrefs, { filter: 'all', sort: 'newest' });
    const validSorts = new Set(['newest', 'oldest', 'post_newest', 'views_desc', 'views_asc', 'author_asc']);
    const sort = raw.sort && validSorts.has(raw.sort) ? raw.sort : 'newest';
    return {
      filter: raw.filter || 'all',
      sort,
    };
  },
  setUiPrefs: (prefs: Partial<UiPrefs>) =>
    storage.getUiPrefs().then((cur) => set(K.uiPrefs, { ...cur, ...prefs })),

  getQueue: () => get<QueueState>(K.queue, emptyQueue()),
  setQueue: (q: QueueState) => set(K.queue, q),

  getScan: () => get<ScanState>(K.scan, emptyScan()),
  setScan: (s: ScanState) => set(K.scan, s),

  getVideos: async (acct: string) => {
    return get<ScannedVideo[]>(K.videos(acct), []);
  },
  setVideos: (acct: string, v: ScannedVideo[]) => set(K.videos(acct), v),

  getSelection: async (acct: string) => new Set(await get<string[]>(K.selection(acct), [])),
  setSelection: (acct: string, sel: Set<string>) => set(K.selection(acct), [...sel]),

  getResults: (acct: string) => get<Record<string, ResultRecord>>(K.results(acct), {}),
  setResults: (acct: string, r: Record<string, ResultRecord>) => set(K.results(acct), r),

  getLog: () => get<LogEntry[]>(K.log, []),
  async appendLog(entries: Omit<LogEntry, 'id' | 'ts'>[] | Omit<LogEntry, 'id' | 'ts'>): Promise<void> {
    const arr = Array.isArray(entries) ? entries : [entries];
    const log = await storage.getLog();
    const now = Date.now();
    for (const e of arr) log.push({ ...e, id: uid('l'), ts: now });
    await set(K.log, log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log);
  },

  getHistory: () => get<HistoryEntry[]>(K.history, []),
  async addHistory(h: HistoryEntry): Promise<void> {
    const list = (await storage.getHistory()).filter((x) => x.runId !== h.runId);
    list.unshift(h);
    await set(K.history, list.slice(0, HISTORY_LIMIT));
  },

  /** Remove everything except settings. */
  async clearAll(): Promise<void> {
    const settings = await storage.getSettings();
    await chrome.storage.local.clear();
    await set(K.settings, settings);
  },
};
