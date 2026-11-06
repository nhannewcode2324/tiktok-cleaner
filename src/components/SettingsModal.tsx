import React, { useState } from 'react';
import type { Lang, Settings, Theme } from '../shared/types';
import { SETTINGS_LIMITS } from '../shared/constants';
import { getT } from '../shared/i18n';
import { CheckCircle2, Lock, Save, Settings as SettingsIcon, Trash2, X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  settings: Settings;
  lang: Lang;
  onSave: (s: Partial<Settings>) => void;
  onClearCache: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  lang,
  onSave,
  onClearCache,
  onClose,
}) => {
  const t = getT(lang);
  const [formData, setFormData] = useState<Settings>({ ...settings });
  const [savedNotice, setSavedNotice] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(formData);
    setSavedNotice(true);
    setTimeout(() => {
      setSavedNotice(false);
      onClose();
    }, 600);
  };

  const handleClearCacheConfirm = () => {
    if (window.confirm(t.clearCacheConfirm)) {
      onClearCache();
      alert(t.cacheCleared);
      onClose();
    }
  };

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
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '20px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SettingsIcon size={20} color="var(--primary-accent)" />
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.settings}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', color: 'var(--text-muted)', padding: '6px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Settings Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Language & Theme Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {t.language}
              </label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value as Lang })}
                style={{
                  width: '100%',
                  marginTop: '6px',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '9px 12px',
                  fontSize: '13px',
                }}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {t.theme}
              </label>
              <select
                value={formData.theme}
                onChange={(e) => setFormData({ ...formData, theme: e.target.value as Theme })}
                style={{
                  width: '100%',
                  marginTop: '6px',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '9px 12px',
                  fontSize: '13px',
                }}
              >
                <option value="dark">{t.dark}</option>
                <option value="light">{t.light}</option>
              </select>
            </div>
          </div>

          {/* Action Delay Slider */}
          <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {t.actionDelay}
              </span>
              <strong style={{ color: 'var(--primary-accent)', fontSize: '13px' }}>
                {formData.actionDelay}s
              </strong>
            </div>
            <input
              type="range"
              min={SETTINGS_LIMITS.actionDelay.min}
              max={SETTINGS_LIMITS.actionDelay.max}
              value={formData.actionDelay}
              onChange={(e) => setFormData({ ...formData, actionDelay: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--primary-accent)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
              <span>Min: {SETTINGS_LIMITS.actionDelay.min}s</span>
              <span>Max: {SETTINGS_LIMITS.actionDelay.max}s</span>
            </div>
          </div>

          {/* Max Items Per Run */}
          <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {t.maxItemsPerRun}
              </span>
              <strong style={{ color: 'var(--secondary-accent)', fontSize: '13px' }}>
                {formData.maxItemsPerRun}
              </strong>
            </div>
            <input
              type="range"
              min={SETTINGS_LIMITS.maxItemsPerRun.min}
              max={SETTINGS_LIMITS.maxItemsPerRun.max}
              step={20}
              value={formData.maxItemsPerRun}
              onChange={(e) => setFormData({ ...formData, maxItemsPerRun: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--secondary-accent)' }}
            />
          </div>

          {/* Retry Limit & Stop on Consecutive Errors */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ backgroundColor: 'var(--bg-card)', padding: '12px', borderRadius: '12px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t.retryLimit}</label>
              <input
                type="number"
                min={SETTINGS_LIMITS.retryLimit.min}
                max={SETTINGS_LIMITS.retryLimit.max}
                value={formData.retryLimit}
                onChange={(e) => setFormData({ ...formData, retryLimit: Number(e.target.value) })}
                style={{
                  width: '100%',
                  marginTop: '4px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '13px',
                }}
              />
            </div>

            <div style={{ backgroundColor: 'var(--bg-card)', padding: '12px', borderRadius: '12px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t.stopOnConsecutiveErrors}</label>
              <input
                type="number"
                min={SETTINGS_LIMITS.stopOnConsecutiveErrors.min}
                max={SETTINGS_LIMITS.stopOnConsecutiveErrors.max}
                value={formData.stopOnConsecutiveErrors}
                onChange={(e) => setFormData({ ...formData, stopOnConsecutiveErrors: Number(e.target.value) })}
                style={{
                  width: '100%',
                  marginTop: '4px',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          {/* Security & Confirmation Check (Locked for safety) */}
          <div
            style={{
              backgroundColor: 'rgba(54, 213, 216, 0.08)',
              border: '1px solid rgba(54, 213, 216, 0.2)',
              borderRadius: '12px',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock size={15} color="var(--secondary-accent)" />
              <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                {t.confirmBeforeCleanupText}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--secondary-accent)', fontWeight: 700 }}>
              ENFORCED
            </span>
          </div>

          {/* Clear Cache Button */}
          <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={handleClearCacheConfirm}
              style={{
                width: '100%',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--danger-color)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '10px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Trash2 size={14} />
              <span>{t.clearCache}</span>
            </button>
            <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', paddingTop: '4px' }}>
              TikTok Cleaner Pro • Developed with ❤️ • <strong style={{ color: 'var(--secondary-accent)' }}>cre: nhangom</strong>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn-secondary" onClick={onClose} style={{ padding: '9px 16px', fontSize: '13px' }}>
            {t.btnCancel}
          </button>
          <button className="btn-primary" onClick={handleSave} style={{ padding: '9px 20px', fontSize: '13px' }}>
            {savedNotice ? <CheckCircle2 size={15} /> : <Save size={15} />}
            <span>{savedNotice ? 'Saved!' : 'Save Settings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
