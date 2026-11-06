import React from 'react';
import type { Lang } from '../shared/types';
import type { SelectionStats } from '../services/selection-manager';
import { getT } from '../shared/i18n';
import { CheckCircle2, CheckSquare, Clock, Heart, Repeat, Video, XCircle } from 'lucide-react';

interface StatsCardsProps {
  stats: SelectionStats;
  lang: Lang;
}

export const StatsCards: React.FC<StatsCardsProps> = ({ stats, lang }) => {
  const t = getT(lang);

  const items = [
    {
      label: t.totalScanned,
      value: stats.totalScanned,
      icon: <Video size={16} color="var(--secondary-accent)" />,
      color: 'var(--secondary-accent)',
    },
    {
      label: t.totalSelected,
      value: stats.totalSelected,
      icon: <CheckSquare size={16} color="var(--primary-accent)" />,
      color: 'var(--primary-accent)',
    },
    {
      label: t.selectedReposts,
      value: stats.selectedReposts,
      icon: <Repeat size={16} color="#FACE15" />,
      color: '#FACE15',
    },
    {
      label: t.selectedLikes,
      value: stats.selectedLikes,
      icon: <Heart size={16} color="var(--primary-accent)" />,
      color: 'var(--primary-accent)',
    },
    {
      label: t.cleaned,
      value: stats.cleaned,
      icon: <CheckCircle2 size={16} color="var(--success-color)" />,
      color: 'var(--success-color)',
    },
    {
      label: t.remaining,
      value: stats.remaining,
      icon: <Clock size={16} color="var(--text-muted)" />,
      color: 'var(--text-muted)',
    },
    {
      label: t.failed,
      value: stats.failed,
      icon: <XCircle size={16} color="var(--danger-color)" />,
      color: 'var(--danger-color)',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: '10px',
        padding: '16px 20px',
      }}
    >
      {items.map((it, idx) => (
        <div
          key={idx}
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              {it.label}
            </span>
            {it.icon}
          </div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: it.color }}>
            {it.value.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
};
