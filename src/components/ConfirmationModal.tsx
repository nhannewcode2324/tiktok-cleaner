import React from 'react';
import type { Lang } from '../shared/types';
import type { SelectionStats } from '../services/selection-manager';
import { getT } from '../shared/i18n';
import { AlertTriangle, CheckCircle, Heart, Repeat, Trash2, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  account: string;
  stats: SelectionStats;
  lang: Lang;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  account,
  stats,
  lang,
  onConfirm,
  onClose,
}) => {
  const t = getT(lang);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '20px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--danger-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Trash2 size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.confirmCleanupTitle}
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {t.targetAccount}: <strong style={{ color: 'var(--text-primary)' }}>@{account}</strong>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: 'var(--text-muted)',
              padding: '6px',
              borderRadius: '8px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Warning Banner */}
        <div
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '12px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}
        >
          <AlertTriangle size={18} color="var(--warning-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <p style={{ fontSize: '12px', color: 'var(--warning-color)', lineHeight: '1.5' }}>
            {t.confirmWarning}
          </p>
        </div>

        {/* Summary Breakdown Cards */}
        <div
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
              <Repeat size={15} color="#FACE15" />
              <span>{t.repostsToRemove}:</span>
            </div>
            <strong style={{ color: '#FACE15', fontSize: '14px' }}>{stats.selectedReposts}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
              <Heart size={15} color="var(--primary-accent)" />
              <span>{t.likesToRemove}:</span>
            </div>
            <strong style={{ color: 'var(--primary-accent)', fontSize: '14px' }}>{stats.selectedLikes}</strong>
          </div>

          <div
            style={{
              height: '1px',
              backgroundColor: 'var(--border-color)',
              margin: '2px 0',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {t.totalVideos}:
            </span>
            <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
              {stats.eligibleSelected}
            </strong>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '10px 18px', fontSize: '13px' }}
          >
            {t.btnCancel}
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            style={{
              padding: '10px 22px',
              fontSize: '13px',
              backgroundColor: 'var(--danger-color)',
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              boxShadow: '0 0 15px rgba(239, 68, 68, 0.4)',
            }}
          >
            <CheckCircle size={15} />
            <span>{t.btnConfirm}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
