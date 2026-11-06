import React from 'react';
import type { Lang, QueueState } from '../shared/types';
import { summarize } from '../services/automation-queue';
import { getT } from '../shared/i18n';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';

interface ProgressPanelProps {
  queue: QueueState;
  lang: Lang;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
}

export const ProgressPanel: React.FC<ProgressPanelProps> = ({
  queue,
  lang,
  onPause,
  onResume,
  onStop,
  onReset,
}) => {
  const t = getT(lang);
  const summary = summarize(queue);

  if (queue.status === 'idle' && summary.total === 0) {
    return null;
  }

  const isRunning = queue.status === 'running';
  const isPausing = queue.status === 'pausing';
  const isPaused = queue.status === 'paused';
  const isStopped = queue.status === 'stopped';
  const isCompleted = queue.status === 'completed';

  const currentJob = queue.jobs.find((j) => j.status === 'processing');

  return (
    <div
      style={{
        margin: '16px 20px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '16px',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Top Title & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {(isRunning || isPausing) && (
            <Loader2
              size={18}
              className="animate-spin"
              color={isPausing ? 'var(--warning-color)' : 'var(--primary-accent)'}
            />
          )}
          {isPaused && <Pause size={18} color="var(--warning-color)" />}
          {isCompleted && <CheckCircle2 size={18} color="var(--success-color)" />}
          {isStopped && <Square size={18} color="var(--danger-color)" />}
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.progressTitle} ({summary.percent}%)
            </h4>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {isRunning
                ? lang === 'vi'
                  ? `Đang xử lý ${currentJob ? `video ${currentJob.videoId}` : 'danh sách...'}`
                  : `Processing ${currentJob ? `Video ${currentJob.videoId}` : 'items...'}`
                : isPausing
                ? lang === 'vi'
                  ? 'Đang tạm dừng ngay...'
                  : 'Pausing...'
                : isPaused
                ? `${t.pausedBanner} ${queue.reason || (lang === 'vi' ? 'Đã tạm dừng' : 'Paused')}`
                : isCompleted
                ? lang === 'vi'
                  ? 'Đã hoàn tất xử lý tất cả video'
                  : 'All jobs processed successfully'
                : queue.reason || (lang === 'vi' ? 'Đã dừng hàng đợi (tiến độ đã lưu)' : 'Queue stopped')}
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {(isRunning || isPausing) && (
            <button
              className="btn-secondary"
              onClick={onPause}
              disabled={isPausing}
              style={{ padding: '7px 12px', fontSize: '12px' }}
            >
              <Pause size={13} />
              <span>
                {isPausing ? (lang === 'vi' ? 'Đang tạm dừng...' : 'Pausing...') : t.btnPause}
              </span>
            </button>
          )}

          {(isPaused || (isStopped && summary.pending > 0)) && (
            <button
              className="btn-primary"
              onClick={onResume}
              style={{ padding: '7px 14px', fontSize: '12px' }}
            >
              <Play size={13} />
              <span>{t.btnResume}</span>
            </button>
          )}

          {(isRunning || isPaused || isPausing) && (
            <button
              className="btn-secondary"
              onClick={onStop}
              style={{
                padding: '7px 12px',
                fontSize: '12px',
                color: 'var(--danger-color)',
                borderColor: 'rgba(239, 68, 68, 0.3)',
              }}
            >
              <Square size={13} />
              <span>{t.btnStop}</span>
            </button>
          )}

          {(isCompleted || isStopped || isPaused) && (
            <button
              className="btn-secondary"
              onClick={onReset}
              title={t.btnReset}
              style={{ padding: '7px 12px', fontSize: '12px' }}
            >
              <RotateCcw size={13} />
              <span>{t.btnReset}</span>
            </button>
          )}
        </div>
      </div>

      {/* HTTP 403 Warning & Safe Resume */}
      {isPaused && queue.reasonCode === 'HTTP_403' && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '12px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '12px',
            color: '#fca5a5',
          }}
        >
          <AlertCircle size={18} color="var(--danger-color)" />
          <div style={{ flex: 1 }}>
            <strong>Phát hiện lỗi HTTP 403 Forbidden từ TikTok</strong>
            <div>Tiến độ dọn dẹp đã được lưu an toàn. Nhấn &quot;Tiếp tục&quot; để tiếp tục dọn dẹp trên trang cá nhân mà không bị mất tiến độ.</div>
          </div>
          <button
            className="btn-primary"
            onClick={onResume}
            style={{ padding: '6px 12px', fontSize: '11px', whiteSpace: 'nowrap' }}
          >
            <Play size={12} />
            <span>Tiếp tục</span>
          </button>
        </div>
      )}

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '9999px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${summary.percent}%`,
            background: 'linear-gradient(90deg, var(--primary-accent), var(--secondary-accent))',
            borderRadius: '9999px',
            transition: 'width 0.4s ease',
            boxShadow: 'var(--shadow-neon-pink)',
          }}
        />
      </div>

      {/* Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
          gap: '8px',
          textAlign: 'center',
          fontSize: '11px',
        }}
      >
        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px' }}>
          <div style={{ color: 'var(--text-muted)' }}>Processed</div>
          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {summary.processed} / {summary.total}
          </strong>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px' }}>
          <div style={{ color: 'var(--success-color)' }}>Success</div>
          <strong style={{ fontSize: '13px', color: 'var(--success-color)' }}>
            {summary.success + summary.skipped}
          </strong>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px' }}>
          <div style={{ color: 'var(--danger-color)' }}>Failed</div>
          <strong style={{ fontSize: '13px', color: 'var(--danger-color)' }}>{summary.failed}</strong>
        </div>

        {summary.unverified > 0 && (
          <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px' }}>
            <div style={{ color: 'var(--warning-color)' }}>Unverified</div>
            <strong style={{ fontSize: '13px', color: 'var(--warning-color)' }}>{summary.unverified}</strong>
          </div>
        )}

        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px' }}>
          <div style={{ color: 'var(--text-muted)' }}>Unavailable</div>
          <strong style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{summary.unavailable}</strong>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '10px' }}>
          <div style={{ color: 'var(--secondary-accent)' }}>Remaining</div>
          <strong style={{ fontSize: '13px', color: 'var(--secondary-accent)' }}>{summary.pending}</strong>
        </div>
      </div>
    </div>
  );
};
