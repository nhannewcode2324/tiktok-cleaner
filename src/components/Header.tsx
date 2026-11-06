import React from 'react';
import type { AccountInfo, Lang, Theme } from '../shared/types';
import { getT } from '../shared/i18n';
import {
  ExternalLink,
  Globe,
  Maximize2,
  Moon,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  Sun,
  UserCheck,
  UserX,
} from 'lucide-react';

interface HeaderProps {
  account: AccountInfo | null;
  lang: Lang;
  theme: Theme;
  isSidePanel?: boolean;
  onRefreshAccount: () => void;
  onOpenTikTok: () => void;
  onOpenDashboard?: () => void;
  onToggleTheme: () => void;
  onToggleLang: () => void;
  onOpenSettings: () => void;
  onResetSession?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  account,
  lang,
  theme,
  isSidePanel,
  onRefreshAccount,
  onOpenTikTok,
  onOpenDashboard,
  onToggleTheme,
  onToggleLang,
  onOpenSettings,
  onResetSession,
}) => {
  const t = getT(lang);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        gap: '12px',
        flexWrap: 'wrap',
      }}
    >
      {/* Brand & Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <img
          src="/icons/icon128.png"
          alt="TikTok Cleaner Pro Logo"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            objectFit: 'cover',
            boxShadow: 'var(--shadow-neon-pink)',
            border: '1px solid rgba(255, 79, 121, 0.3)',
          }}
        />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.3px' }}>
              TikTok Cleaner
            </span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, var(--primary-accent), var(--secondary-accent))',
                color: '#fff',
                padding: '1px 6px',
                borderRadius: '6px',
              }}
            >
              PRO
            </span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'var(--secondary-accent)',
                backgroundColor: 'rgba(54, 213, 216, 0.12)',
                border: '1px solid rgba(54, 213, 216, 0.3)',
                padding: '1px 6px',
                borderRadius: '6px',
              }}
            >
              cre: nhangom
            </span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {t.tagline} • <span style={{ color: 'var(--secondary-accent)', fontWeight: 500 }}>cre: nhangom</span>
          </div>
        </div>
      </div>

      {/* Account Status Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {account?.loggedIn && account.username ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              padding: '6px 12px',
              borderRadius: '20px',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--success-color)',
                boxShadow: '0 0 8px var(--success-color)',
              }}
            />
            <UserCheck size={14} color="var(--success-color)" />
            <span style={{ fontSize: '12px', fontWeight: 600 }}>@{account.username}</span>
            <button
              onClick={onRefreshAccount}
              title={t.refreshAccount}
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                padding: '2px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Đặt lại toàn bộ danh sách quét và thống kê về 0?')) {
                  onResetSession?.();
                }
              }}
              title="Đặt lại toàn bộ về 0"
              style={{
                background: 'transparent',
                color: 'var(--text-muted)',
                padding: '2px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                marginLeft: '2px',
              }}
            >
              <RotateCcw size={12} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                padding: '6px 12px',
                borderRadius: '20px',
              }}
            >
              <UserX size={14} color="var(--text-muted)" />
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t.notConnected}</span>
            </div>
            <button
              className="btn-primary"
              onClick={onOpenTikTok}
              style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '20px' }}
            >
              <ExternalLink size={12} />
              <span>{t.openTikTok}</span>
            </button>
          </div>
        )}

        {/* Action Controls */}
        {isSidePanel && onOpenDashboard && (
          <button
            className="btn-secondary"
            onClick={onOpenDashboard}
            title={t.openDashboard}
            style={{ padding: '7px 10px', borderRadius: '10px' }}
          >
            <Maximize2 size={15} />
          </button>
        )}

        <button
          className="btn-secondary"
          onClick={onToggleLang}
          title={lang === 'vi' ? 'Chuyển sang English' : 'Switch to Vietnamese'}
          style={{ padding: '7px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600 }}
        >
          <Globe size={14} />
          <span>{lang.toUpperCase()}</span>
        </button>

        <button
          className="btn-secondary"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          style={{ padding: '7px 10px', borderRadius: '10px' }}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          className="btn-secondary"
          onClick={onOpenSettings}
          title={t.settings}
          style={{ padding: '7px 10px', borderRadius: '10px' }}
        >
          <SettingsIcon size={15} />
        </button>
      </div>
    </header>
  );
};
