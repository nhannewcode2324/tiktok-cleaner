import React, { useEffect, useState } from 'react';
import type { Lang, ResultRecord, ScannedVideo } from '../shared/types';
import { VideoCard } from './VideoCard';
import { getT } from '../shared/i18n';
import { RefreshCw, SearchX } from 'lucide-react';

interface VideoGalleryProps {
  videos: ScannedVideo[];
  selectedKeys: Set<string>;
  results: Record<string, ResultRecord | undefined>;
  processingKey?: string | null;
  isScanning: boolean;
  lang: Lang;
  onToggleVideo: (key: string) => void;
  onStartScan: () => void;
}

const PAGE_SIZE = 60;

export const VideoGallery: React.FC<VideoGalleryProps> = ({
  videos,
  selectedKeys,
  results,
  processingKey,
  isScanning,
  lang,
  onToggleVideo,
  onStartScan,
}) => {
  const t = getT(lang);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset page size only when list is cleared (do NOT reset when appending batches or toggling selection)
  useEffect(() => {
    if (videos.length === 0) {
      setVisibleCount(PAGE_SIZE);
    }
  }, [videos.length]);

  const displayedVideos = videos.slice(0, visibleCount);

  if (videos.length === 0) {
    if (isScanning) {
      return (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: '16px',
            padding: '20px',
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{
                width: '100%',
                paddingTop: '160%',
                borderRadius: '16px',
              }}
            />
          ))}
        </div>
      );
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          textAlign: 'center',
          gap: '16px',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            backgroundColor: 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-color)',
          }}
        >
          <SearchX size={32} color="var(--text-muted)" />
        </div>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            No Videos Found
          </div>
          <div style={{ fontSize: '13px', maxWidth: '360px', color: 'var(--text-secondary)' }}>
            Scan your TikTok profile to discover your Reposts and Liked videos, or adjust your search filters.
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={onStartScan}
          style={{ marginTop: '8px' }}
        >
          <RefreshCw size={15} />
          <span>{t.scanVideos}</span>
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px' }}>
      {/* Video Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
          gap: '14px',
        }}
      >
        {displayedVideos.map((v) => (
          <VideoCard
            key={v.key}
            video={v}
            isSelected={selectedKeys.has(v.key)}
            result={results[v.key]}
            isProcessing={processingKey === v.key}
            onToggle={onToggleVideo}
          />
        ))}
      </div>

      {/* Incremental Rendering / Load More button */}
      {visibleCount < videos.length && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 32px 0' }}>
          <button
            className="btn-secondary"
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            style={{ padding: '10px 24px', fontSize: '13px' }}
          >
            Load More Videos ({videos.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </div>
  );
};
