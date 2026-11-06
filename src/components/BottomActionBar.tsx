import React from 'react';
import type { Lang } from '../shared/types';
import type { SelectionStats } from '../services/selection-manager';
import { getT } from '../shared/i18n';
import { Heart, Pause, Repeat, Square, StopCircle, Trash2 } from 'lucide-react';

interface BottomActionBarProps {
  stats: SelectionStats;
  isRunning: boolean;
  isScanning?: boolean;
  lang: Lang;
  onOpenConfirmation: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onStopScan?: () => void;
}

export const BottomActionBar: React.FC<BottomActionBarProps> = ({
  stats,
  isRunning,
  isScanning = false,
  lang,
  onOpenConfirmation,
  onPause,
  onStop,
  onStopScan,
}) => {
  const t = getT(lang);
  const eligibleCount = stats.eligibleSelected;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        backgroundColor: 'rgba(28, 30, 38, 0.95)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border-color)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 -10px 25px -5px rgba(0, 0, 0, 0.5)',
        gap: '16px',
        flexWrap: 'wrap',
      }}
    >
      {/* Selection summary info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {eligibleCount}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {t.totalSelected}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span
            className="badge badge-repost"
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            <Repeat size={11} />
            <span>{stats.selectedReposts} Reposts</span>
          </span>
          <span
            className="badge badge-like"
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            <Heart size={11} />
            <span>{stats.selectedLikes} Likes</span>
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
            cre: <strong style={{ color: 'var(--secondary-accent)' }}>nhangom</strong>
          </span>
        </div>
      </div>

      {/* Action Buttons: Stop/Pause when running or scanning, otherwise Cleanup */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isScanning && onStopScan && (
          <button
            className="btn-secondary"
            onClick={onStopScan}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 700,
              borderRadius: '12px',
              color: 'var(--danger-color)',
              borderColor: 'rgba(239, 68, 68, 0.45)',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
            }}
          >
            <StopCircle size={15} />
            <span>{t.stopScan}</span>
          </button>
        )}

        {isRunning ? (
          <>
            {onPause && (
              <button
                className="btn-secondary"
                onClick={onPause}
                style={{
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '12px',
                }}
              >
                <Pause size={15} />
                <span>{t.btnPause}</span>
              </button>
            )}
            {onStop && (
              <button
                className="btn-secondary"
                onClick={onStop}
                style={{
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: 700,
                  borderRadius: '12px',
                  color: 'var(--danger-color)',
                  borderColor: 'rgba(239, 68, 68, 0.45)',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                }}
              >
                <Square size={15} />
                <span>{t.btnStop}</span>
              </button>
            )}
          </>
        ) : (
          !isScanning && (
            <button
              className="btn-primary"
              disabled={eligibleCount === 0}
              onClick={onOpenConfirmation}
              style={{
                padding: '12px 28px',
                fontSize: '14px',
                fontWeight: 700,
                borderRadius: '14px',
              }}
            >
              <Trash2 size={16} />
              <span>{t.cleanupSelected} ({eligibleCount})</span>
            </button>
          )
        )}
      </div>
    </div>
  );
};
