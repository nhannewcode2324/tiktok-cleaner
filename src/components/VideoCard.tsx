import React, { useState } from 'react';
import type { ResultRecord, ScannedVideo } from '../shared/types';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  Repeat,
  VideoOff,
  XCircle,
} from 'lucide-react';

interface VideoCardProps {
  video: ScannedVideo;
  isSelected: boolean;
  result?: ResultRecord;
  isProcessing?: boolean;
  onToggle: (key: string) => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  video,
  isSelected,
  result,
  isProcessing,
  onToggle,
}) => {
  const [imgError, setImgError] = useState(false);

  const status = result?.status;

  const getStatusBadge = () => {
    if (isProcessing) {
      return (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            color: 'var(--secondary-accent)',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Loader2 size={12} className="animate-spin" />
          <span>Processing...</span>
        </div>
      );
    }

    if (status === 'success' || status === 'skipped') {
      return (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            backgroundColor: 'rgba(16, 185, 129, 0.9)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <CheckCircle2 size={12} />
          <span>{status === 'skipped' ? 'Skipped' : 'Cleaned'}</span>
        </div>
      );
    }

    if (status === 'unverified') {
      return (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            backgroundColor: 'rgba(245, 158, 11, 0.92)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title={result?.error || 'Unverified'}
        >
          <AlertTriangle size={12} />
          <span>Unverified</span>
        </div>
      );
    }

    if (status === 'failed') {
      return (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.9)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title={result?.error || 'Failed'}
        >
          <XCircle size={12} />
          <span>Failed</span>
        </div>
      );
    }

    if (status === 'unavailable' || video.isUnavailable) {
      return (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.9)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title={result?.error || 'Video đã bị xóa hoặc ẩn'}
        >
          <EyeOff size={12} />
          <span>Bị ẩn / Đã xóa</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      onClick={() => onToggle(video.key)}
      style={{
        position: 'relative',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '16px',
        overflow: 'hidden',
        border: `2px solid ${
          isSelected
            ? video.kind === 'repost'
              ? 'var(--secondary-accent)'
              : 'var(--primary-accent)'
            : 'var(--border-color)'
        }`,
        boxShadow: isSelected
          ? video.kind === 'repost'
            ? 'var(--shadow-neon-cyan)'
            : 'var(--shadow-neon-pink)'
          : 'var(--shadow-card)',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)');
      }}
      onMouseLeave={(e) => {
        if (!isSelected) (e.currentTarget.style.borderColor = 'var(--border-color)');
      }}
    >
      {/* 9:16 Aspect Ratio Media Box */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingTop: '160%', // ~9:16 ratio
          backgroundColor: '#0a0b0e',
          overflow: 'hidden',
        }}
      >
        {video.thumbnail && !imgError ? (
          <img
            src={video.thumbnail}
            alt={video.description || video.author}
            loading="lazy"
            onError={() => setImgError(true)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: 'transform 0.3s ease',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: 'var(--text-muted)',
              background: 'linear-gradient(180deg, #181a22 0%, #0e1015 100%)',
            }}
          >
            <VideoOff size={32} />
            <span style={{ fontSize: '11px' }}>No Thumbnail</span>
          </div>
        )}

        {/* Gradient Overlay for bottom text visibility */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '45%',
            background: 'linear-gradient(to top, rgba(16, 17, 22, 0.95), transparent)',
            pointerEvents: 'none',
          }}
        />

        {/* Overlay for unavailable / deleted videos */}
        {(video.isUnavailable || status === 'unavailable') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(16, 17, 22, 0.7)',
              backdropFilter: 'blur(2px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              color: '#ff4f79',
              zIndex: 3,
            }}
          >
            <EyeOff size={28} />
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.2px' }}>
              Bị ẩn hoặc đã xóa
            </span>
          </div>
        )}

        {/* Top Badges & Checkbox */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            right: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            zIndex: 4,
          }}
        >
          {/* Repost / Like Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {video.kind === 'repost' ? (
              <span className="badge badge-repost">
                <Repeat size={10} />
                <span>Repost</span>
              </span>
            ) : (
              <span className="badge badge-like">
                <Heart size={10} />
                <span>Liked</span>
              </span>
            )}
            {(video.isUnavailable || status === 'unavailable') && (
              <span
                className="badge"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.25)',
                  color: '#ff6b81',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                }}
              >
                <EyeOff size={9} />
                <span>Bị ẩn/xóa</span>
              </span>
            )}
          </div>

          {/* Custom Checkbox */}
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '8px',
              backgroundColor: isSelected
                ? video.kind === 'repost'
                  ? 'var(--secondary-accent)'
                  : 'var(--primary-accent)'
                : 'rgba(0, 0, 0, 0.65)',
              border: `2px solid ${
                isSelected
                  ? '#ffffff'
                  : 'rgba(255, 255, 255, 0.5)'
              }`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)',
              transition: 'all 0.2s ease',
              boxShadow: isSelected ? '0 0 10px rgba(0, 0, 0, 0.5)' : 'none',
            }}
          >
            {isSelected && <Check size={14} color="#ffffff" strokeWidth={3} />}
          </div>
        </div>

        {/* View Count Badge */}
        {video.viewsText && (
          <div
            style={{
              position: 'absolute',
              top: '40px',
              left: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              padding: '2px 6px',
              borderRadius: '6px',
              fontSize: '10px',
              fontWeight: 600,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <Eye size={10} />
            <span>{video.viewsText}</span>
          </div>
        )}

        {/* Status Badge */}
        {getStatusBadge()}
      </div>

      {/* Card Info Section */}
      <div
        style={{
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '6px',
          backgroundColor: 'var(--bg-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            @{video.author}
          </span>
          <a
            href={video.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open video on TikTok"
            style={{
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              padding: '2px',
              borderRadius: '4px',
            }}
          >
            <ExternalLink size={13} />
          </a>
        </div>

        {video.description && (
          <p
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: '1.4',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
};
