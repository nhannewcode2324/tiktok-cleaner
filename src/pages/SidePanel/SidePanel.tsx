import React from 'react';
import '../../styles/index.css';
import { useTikTokCleaner } from '../../hooks/useTikTokCleaner';
import { Header } from '../../components/Header';
import { StatsCards } from '../../components/StatsCards';
import { SelectionToolbar } from '../../components/SelectionToolbar';
import { FilterBar } from '../../components/FilterBar';
import { VideoGallery } from '../../components/VideoGallery';
import { BottomActionBar } from '../../components/BottomActionBar';
import { ProgressPanel } from '../../components/ProgressPanel';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { SettingsModal } from '../../components/SettingsModal';

export const SidePanel: React.FC = () => {
  const {
    settings,
    account,
    videos,
    selectedKeys,
    results,
    queue,
    scanState,
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
  } = useTikTokCleaner();

  const isRunning = queue.status === 'running' || queue.status === 'pausing';
  const processingJob = queue.jobs.find((j) => j.status === 'processing');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--bg-main)' }}>
      {/* Header */}
      <Header
        account={account}
        lang={settings.language}
        theme={settings.theme}
        isSidePanel={true}
        onRefreshAccount={handleRefreshAccount}
        onOpenTikTok={handleOpenTikTok}
        onOpenDashboard={handleOpenDashboard}
        onToggleTheme={handleToggleTheme}
        onToggleLang={handleToggleLang}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onResetSession={handleResetSession}
      />

      {/* Stats Cards */}
      <StatsCards stats={stats} lang={settings.language} />

      {/* Progress Panel (when active or paused) */}
      <ProgressPanel
        queue={queue}
        lang={settings.language}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onReset={handleResetProgress}
      />

      {/* Selection Toolbar */}
      <SelectionToolbar
        lang={settings.language}
        scanState={scanState}
        hasVideos={videos.length > 0}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        onInvertSelection={handleInvertSelection}
        onSelectReposts={handleSelectReposts}
        onSelectLikes={handleSelectLikes}
        onSelectUnavailable={handleSelectUnavailable}
        onSelectVisible={handleSelectVisible}
        onSelectAllScanned={handleSelectAllScanned}
        onStartScan={handleStartScan}
        onStopScan={handleStopScan}
        onResetSession={handleResetSession}
      />

      {/* Filter and Search Bar */}
      <FilterBar
        lang={settings.language}
        search={search}
        filter={filter}
        sort={sort}
        counts={filterCounts}
        onSearchChange={setSearch}
        onFilterChange={setFilter}
        onSortChange={setSort}
      />

      {/* Video Gallery */}
      <div style={{ flex: 1 }}>
        <VideoGallery
          videos={displayedVideos}
          selectedKeys={selectedKeys}
          results={results}
          processingKey={processingJob?.key}
          isScanning={scanState.status === 'scanning'}
          lang={settings.language}
          onToggleVideo={handleToggleVideo}
          onStartScan={() => handleStartScan(['repost', 'like'])}
        />
      </div>

      {/* Sticky Bottom Action Bar */}
      <BottomActionBar
        stats={stats}
        isRunning={isRunning}
        isScanning={scanState.status === 'scanning'}
        lang={settings.language}
        onOpenConfirmation={() => setIsConfirmOpen(true)}
        onPause={handlePause}
        onStop={handleStop}
        onStopScan={handleStopScan}
      />

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmOpen}
        account={account?.username || ''}
        stats={stats}
        lang={settings.language}
        onConfirm={handleStartCleanup}
        onClose={() => setIsConfirmOpen(false)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        lang={settings.language}
        onSave={handleSaveSettings}
        onClearCache={handleClearCache}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
