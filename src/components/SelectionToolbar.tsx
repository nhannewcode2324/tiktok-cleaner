import React from 'react';
import type { Lang, ScanState } from '../shared/types';
import { getT } from '../shared/i18n';
import {
  AlertCircle,
  CheckCircle2,
  CheckCheck,
  CheckSquare,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  RefreshCw,
  Repeat,
  RotateCcw,
  ScanLine,
  Square,
  SquareDashed,
  StopCircle,
} from 'lucide-react';

interface SelectionToolbarProps {
  lang: Lang;
  scanState: ScanState;
  hasVideos: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onInvertSelection: () => void;
  onSelectReposts: () => void;
  onSelectLikes: () => void;
  onSelectUnavailable: () => void;
  onSelectVisible: () => void;
  onSelectAllScanned: () => void;
  onStartScan: (kinds: ('repost' | 'like')[]) => void;
  onStopScan: () => void;
  onResetSession?: () => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  lang,
  scanState,
  hasVideos,
  onSelectAll,
  onDeselectAll,
  onInvertSelection,
  onSelectReposts,
  onSelectLikes,
  onSelectUnavailable,
  onSelectVisible,
  onSelectAllScanned,
  onStartScan,
  onStopScan,
  onResetSession,
}) => {
  const t = getT(lang);
  const isScanning = scanState.status === 'scanning';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px 20px',
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-color)',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      {/* ================= KHỐI 1: BỘ CÔNG CỤ QUÉT DỮ LIỆU TIKTOK ================= */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ScanLine size={14} color="var(--primary-accent)" />
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
              {t.scanSectionTitle}
            </span>
          </div>
          {isScanning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--secondary-accent)' }}>
              <Loader2 size={13} className="animate-spin" />
              <span>{scanState.message || t.scanning}</span>
            </div>
          )}
          {scanState.status === 'done' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--success-color)',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                padding: '3px 8px',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              <CheckCircle2 size={13} color="var(--success-color)" />
              <span>{scanState.message || 'Quét thành công!'}</span>
            </div>
          )}
          {scanState.status === 'stopped' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--warning-color)',
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                padding: '3px 8px',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              <StopCircle size={13} color="var(--warning-color)" />
              <span>{scanState.message || 'Đã dừng quét'}</span>
            </div>
          )}
          {scanState.status === 'error' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--danger-color)',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                padding: '3px 8px',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              <AlertCircle size={13} color="var(--danger-color)" />
              <span>{scanState.message || 'Quét thất bại'}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {isScanning ? (
            <button
              className="btn-secondary"
              onClick={onStopScan}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                borderRadius: '10px',
                color: 'var(--danger-color)',
                borderColor: 'rgba(239, 68, 68, 0.4)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fontWeight: 600,
              }}
            >
              <StopCircle size={14} />
              <span>{t.stopScan}</span>
            </button>
          ) : (
            <>
              {/* Quét cả hai */}
              <button
                className="btn-primary"
                onClick={() => onStartScan(['repost', 'like'])}
                style={{ padding: '8px 16px', fontSize: '12px', borderRadius: '10px' }}
                title="Tự động quét cả video đã Repost và video đã Thả tim"
              >
                <RefreshCw size={13} />
                <span>{t.scanBoth}</span>
              </button>

              {/* Chỉ quét Reposts */}
              <button
                className="btn-secondary"
                onClick={() => onStartScan(['repost'])}
                title="Chỉ quét các video người dùng đã Repost (Đăng lại)"
                style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '10px', color: '#FACE15' }}
              >
                <Repeat size={13} color="#FACE15" />
                <span>{t.scanReposts}</span>
              </button>

              {/* Chỉ quét Likes */}
              <button
                className="btn-secondary"
                onClick={() => onStartScan(['like'])}
                title="Chỉ quét các video người dùng đã Thả tim (Liked)"
                style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '10px', color: 'var(--primary-accent)' }}
              >
                <Heart size={13} color="var(--primary-accent)" />
                <span>{t.scanLikes}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* ================= KHỐI 2: BỘ CÔNG CỤ THAO TÁC LỰA CHỌN VIDEO ================= */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CheckSquare size={14} color="var(--secondary-accent)" />
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
            {t.selectionSectionTitle}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onSelectAll}
            title={t.selectAll}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px' }}
          >
            <CheckCheck size={13} />
            <span>{t.selectAll}</span>
          </button>

          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onDeselectAll}
            title={t.deselectAll}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px' }}
          >
            <Square size={13} />
            <span>{t.deselectAll}</span>
          </button>

          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onInvertSelection}
            title={t.invertSelection}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px' }}
          >
            <SquareDashed size={13} />
            <span>{t.invertSelection}</span>
          </button>

          {/* Chọn theo mục Repost */}
          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onSelectReposts}
            title={t.selectReposts}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px', borderColor: 'rgba(250, 206, 21, 0.3)' }}
          >
            <Repeat size={13} color="#FACE15" />
            <span>{t.selectReposts}</span>
          </button>

          {/* Chọn theo mục Likes */}
          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onSelectLikes}
            title={t.selectLikes}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px', borderColor: 'rgba(255, 79, 121, 0.3)' }}
          >
            <Heart size={13} color="var(--primary-accent)" />
            <span>{t.selectLikes}</span>
          </button>

          {/* Chọn video Bị ẩn / Đã xóa */}
          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onSelectUnavailable}
            title="Chọn tất cả các video đã bị xóa hoặc ẩn để dọn dẹp"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              borderRadius: '8px',
              color: '#ff6b81',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderColor: 'rgba(239, 68, 68, 0.4)',
              fontWeight: 600,
            }}
          >
            <EyeOff size={13} color="#ff6b81" />
            <span>{t.selectUnavailable}</span>
          </button>

          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onSelectVisible}
            title={t.selectVisible}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px' }}
          >
            <Eye size={13} />
            <span>{t.selectVisible}</span>
          </button>

          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={onSelectAllScanned}
            title={t.selectAllScanned}
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px' }}
          >
            <CheckCheck size={13} color="var(--secondary-accent)" />
            <span>{t.selectAllScanned}</span>
          </button>

          <button
            className="btn-secondary"
            disabled={!hasVideos || isScanning}
            onClick={() => {
              if (window.confirm('Đặt lại toàn bộ danh sách và số đếm về 0?')) {
                onResetSession?.();
              }
            }}
            title="Đặt lại toàn bộ danh sách và số đếm về 0"
            style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px', color: 'var(--text-muted)' }}
          >
            <RotateCcw size={13} />
            <span>Đặt về 0</span>
          </button>
        </div>
      </div>
    </div>
  );
};
