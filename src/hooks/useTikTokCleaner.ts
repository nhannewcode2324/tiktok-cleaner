import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AccountInfo,
  LogEntry,
  QueueState,
  ResultRecord,
  ScanState,
  ScannedVideo,
  Settings,
  VideoKind,
} from '../shared/types';
import {
  FilterKind,
  SortKey,
  computeStats,
  deselectAll,
  filterVideos,
  invertSelection,
  selectAllInModes,
  selectAllScanned,
  selectKind,
  selectUnavailable,
  selectVisible,
  toggle,
} from '../services/selection-manager';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { emptyQueue, requestPause, resume, stop, summarize } from '../services/automation-queue';
import { emptyScan, storage } from '../services/storage-manager';

export function useTikTokCleaner() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [videos, setVideos] = useState<ScannedVideo[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ResultRecord>>({});
  const [queue, setQueue] = useState<QueueState>(emptyQueue());
  const [scanState, setScanState] = useState<ScanState>(emptyScan());
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Search, filter & sort state (defaults strictly to 'newest' = MỚI NHẤT → CŨ NHẤT)
  const [search, setSearch] = useState('');
  const [filter, setFilterState] = useState<FilterKind>('all');
  const [sort, setSortState] = useState<SortKey>('newest');

  const setFilter = useCallback((nextFilter: FilterKind) => {
    setFilterState(nextFilter);
    storage.setUiPrefs({ filter: nextFilter }).catch(() => {});
  }, []);

  const setSort = useCallback((nextSort: SortKey) => {
    setSortState(nextSort);
    storage.setUiPrefs({ sort: nextSort }).catch(() => {});
  }, []);

  // Modals state
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Sync theme with document attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Load initial state
  const reloadData = useCallback(async () => {
    const s = await storage.getSettings();
    setSettings(s);

    const prefs = await storage.getUiPrefs();
    setFilterState((prefs.filter as FilterKind) || 'all');
    setSortState((prefs.sort as SortKey) || 'newest');

    const q = await storage.getQueue();
    setQueue(q);

    const sc = await storage.getScan();
    setScanState(sc);

    const l = await storage.getLog();
    setLogs(l);

    const acc = await storage.getAccount();
    setAccount(acc);

    if (acc?.username) {
      const v = await storage.getVideos(acc.username);
      setVideos(v);

      const sel = await storage.getSelection(acc.username);
      setSelectedKeys(sel);

      const r = await storage.getResults(acc.username);
      setResults(r);
    } else {
      setVideos([]);
      setSelectedKeys(new Set());
      setResults({});
    }
  }, []);

  useEffect(() => {
    reloadData();
    chrome.runtime.sendMessage({ type: 'GET_ACCOUNT', refresh: true }).catch(() => {});

    // Keep checking for connected TikTok tab
    const timer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'GET_ACCOUNT' }).catch(() => {});
    }, 3000);

    // Listen to chrome.storage changes for real-time reactivity
    const handleStorageChange = (_changes: { [key: string]: chrome.storage.StorageChange }) => {
      reloadData();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      clearInterval(timer);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [reloadData]);

  // Save selection changes
  const updateSelection = useCallback(
    (nextSel: Set<string>) => {
      setSelectedKeys(nextSel);
      if (account?.username) {
        storage.setSelection(account.username, nextSel);
      }
    },
    [account?.username]
  );

  // Computed selection stats — synchronized with active/paused/completed queue run
  const stats = useMemo(() => {
    const base = computeStats(videos, selectedKeys, results);
    if (queue.status !== 'idle' && queue.jobs.length > 0) {
      const qSum = summarize(queue);
      return {
        ...base,
        cleaned: qSum.success + qSum.skipped,
        failed: qSum.failed + qSum.unverified + qSum.unavailable,
        remaining: qSum.pending + qSum.processing,
      };
    }
    return base;
  }, [videos, selectedKeys, results, queue]);

  // Filtered and sorted videos for display
  const displayedVideos = useMemo(() => {
    return filterVideos(videos, selectedKeys, results, { filter, search, sort });
  }, [videos, selectedKeys, results, filter, search, sort]);

  // Filter counts
  const filterCounts = useMemo(() => {
    const counts: Record<FilterKind, number> = {
      all: videos.length,
      repost: 0,
      like: 0,
      selected: 0,
      unselected: 0,
      success: 0,
      failed: 0,
      unavailable: 0,
    };
    for (const v of videos) {
      if (v.kind === 'repost') counts.repost++;
      if (v.kind === 'like') counts.like++;
      if (selectedKeys.has(v.key)) counts.selected++;
      else counts.unselected++;
      const st = results[v.key]?.status;
      if (st === 'success' || st === 'skipped') counts.success++;
      if (st === 'failed' || st === 'unverified') counts.failed++;
      if (st === 'unavailable') counts.unavailable++;
    }
    return counts;
  }, [videos, selectedKeys, results]);

  // Actions
  const handleToggleVideo = useCallback(
    (key: string) => {
      updateSelection(toggle(selectedKeys, key));
    },
    [selectedKeys, updateSelection]
  );

  const handleSelectAll = useCallback(() => {
    updateSelection(selectAllInModes(videos, results, ['repost', 'like']));
  }, [videos, results, updateSelection]);

  const handleDeselectAll = useCallback(() => {
    updateSelection(deselectAll());
  }, [updateSelection]);

  const handleInvertSelection = useCallback(() => {
    updateSelection(invertSelection(selectedKeys, displayedVideos, results));
  }, [selectedKeys, displayedVideos, results, updateSelection]);

  const handleSelectReposts = useCallback(() => {
    updateSelection(selectKind(videos, results, 'repost'));
  }, [videos, results, updateSelection]);

  const handleSelectLikes = useCallback(() => {
    updateSelection(selectKind(videos, results, 'like'));
  }, [videos, results, updateSelection]);

  const handleSelectUnavailable = useCallback(() => {
    updateSelection(selectUnavailable(videos, results));
  }, [videos, results, updateSelection]);

  const handleSelectVisible = useCallback(() => {
    updateSelection(selectVisible(displayedVideos, results));
  }, [displayedVideos, results, updateSelection]);

  const handleSelectAllScanned = useCallback(() => {
    updateSelection(selectAllScanned(videos, results));
  }, [videos, results, updateSelection]);

  const handleStartScan = useCallback((kinds: VideoKind[]) => {
    chrome.runtime.sendMessage({ type: 'START_SCAN', kinds }).catch(() => {});
  }, []);

  const handleStopScan = useCallback(() => {
    setScanState((prev) =>
      prev.status === 'scanning'
        ? {
            ...prev,
            status: 'stopped',
            currentKind: null,
            message: 'Đã dừng quét; các video thu thập được đã được giữ lại.',
            finishedAt: Date.now(),
          }
        : prev
    );
    chrome.runtime.sendMessage({ type: 'STOP_SCAN' }).catch(() => {});
  }, []);

  const handleStartCleanup = useCallback(() => {
    const keys = [...selectedKeys];
    chrome.runtime.sendMessage({ type: 'START_CLEANUP', keys, confirmed: true }).catch(() => {});
  }, [selectedKeys]);

  const handlePause = useCallback(() => {
    setQueue((prev) => requestPause(prev));
    chrome.runtime.sendMessage({ type: 'PAUSE' }).catch(() => {});
  }, []);

  const handleResume = useCallback(() => {
    setQueue((prev) => resume(prev));
    chrome.runtime.sendMessage({ type: 'RESUME' }).catch(() => {});
  }, []);

  const handleStop = useCallback(() => {
    setQueue((prev) => stop(prev, Date.now(), 'Đã dừng theo yêu cầu người dùng (tiến độ được giữ nguyên)'));
    chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
  }, []);

  const handleResetProgress = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'RESET_PROGRESS', confirmed: true }).catch(() => {});
  }, []);

  const handleSaveSettings = useCallback(async (s: Partial<Settings>) => {
    const next = await storage.saveSettings(s);
    setSettings(next);
  }, []);

  const handleClearCache = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', confirmed: true }).catch(() => {});
    reloadData();
  }, [reloadData]);

  const handleResetSession = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: 'RESET_SESSION' }).catch(() => {});
    reloadData();
  }, [reloadData]);

  const handleRefreshAccount = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_ACCOUNT', refresh: true }).catch(() => {});
  }, []);

  const handleOpenTikTok = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_TIKTOK' }).catch(() => {});
  }, []);

  const handleOpenDashboard = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' }).catch(() => {});
  }, []);

  const handleToggleTheme = useCallback(() => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    handleSaveSettings({ theme: nextTheme });
  }, [settings.theme, handleSaveSettings]);

  const handleToggleLang = useCallback(() => {
    const nextLang = settings.language === 'vi' ? 'en' : 'vi';
    handleSaveSettings({ language: nextLang });
  }, [settings.language, handleSaveSettings]);

  return {
    settings,
    account,
    videos,
    selectedKeys,
    results,
    queue,
    scanState,
    logs,
    search,
    filter,
    sort,
    stats,
    displayedVideos,
    filterCounts,
    isConfirmOpen,
    isSettingsOpen,
    setSearch,
    setFilter,
    setSort,
    setIsConfirmOpen,
    setIsSettingsOpen,
    handleToggleVideo,
    handleSelectAll,
    handleDeselectAll,
    handleInvertSelection,
    handleSelectReposts,
    handleSelectLikes,
    handleSelectUnavailable,
    handleSelectVisible,
    handleSelectAllScanned,
    handleStartScan,
    handleStopScan,
    handleStartCleanup,
    handlePause,
    handleResume,
    handleStop,
    handleResetProgress,
    handleSaveSettings,
    handleClearCache,
    handleResetSession,
    handleRefreshAccount,
    handleOpenTikTok,
    handleOpenDashboard,
    handleToggleTheme,
    handleToggleLang,
  };
}
