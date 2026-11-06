import React from 'react';
import type { Lang } from '../shared/types';
import type { FilterKind, SortKey } from '../services/selection-manager';
import { getT } from '../shared/i18n';
import { ArrowUpDown, Search, X } from 'lucide-react';

interface FilterBarProps {
  lang: Lang;
  search: string;
  filter: FilterKind;
  sort: SortKey;
  counts: Record<FilterKind, number>;
  onSearchChange: (search: string) => void;
  onFilterChange: (filter: FilterKind) => void;
  onSortChange: (sort: SortKey) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  lang,
  search,
  filter,
  sort,
  counts,
  onSearchChange,
  onFilterChange,
  onSortChange,
}) => {
  const t = getT(lang);

  const filterTabs: { key: FilterKind; label: string }[] = [
    { key: 'all', label: `${t.filterAll} (${counts.all || 0})` },
    { key: 'repost', label: `${t.filterRepost} (${counts.repost || 0})` },
    { key: 'like', label: `${t.filterLike} (${counts.like || 0})` },
    { key: 'selected', label: `${t.filterSelected} (${counts.selected || 0})` },
    { key: 'unselected', label: `${t.filterUnselected} (${counts.unselected || 0})` },
    { key: 'success', label: `${t.filterSuccess} (${counts.success || 0})` },
    { key: 'failed', label: `${t.filterFailed} (${counts.failed || 0})` },
    { key: 'unavailable', label: `${t.filterUnavailable} (${counts.unavailable || 0})` },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '12px 20px',
        backgroundColor: 'var(--bg-main)',
      }}
    >
      {/* Search Input & Sort Dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* Search Input */}
        <div
          style={{
            flex: '1',
            minWidth: '240px',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search
            size={16}
            color="var(--text-muted)"
            style={{ position: 'absolute', left: '12px', pointerEvents: 'none' }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.searchPlaceholder}
            style={{
              width: '100%',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '9px 36px 9px 36px',
              fontSize: '13px',
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--primary-accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)')}
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              style={{
                position: 'absolute',
                right: '10px',
                background: 'transparent',
                color: 'var(--text-muted)',
                padding: '4px',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Sort Select */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ArrowUpDown size={15} color="var(--text-muted)" />
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            style={{
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '9px 14px',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="newest">{t.sortNewest}</option>
            <option value="oldest">{t.sortOldest}</option>
            <option value="post_newest">{t.sortPostNewest}</option>
            <option value="views_desc">{t.sortViewsDesc}</option>
            <option value="views_asc">{t.sortViewsAsc}</option>
            <option value="author_asc">{t.sortAuthorAsc}</option>
          </select>
        </div>
      </div>

      {/* Filter Tabs / Pills */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
      >
        {filterTabs.map((tb) => {
          const isActive = filter === tb.key;
          return (
            <button
              key={tb.key}
              onClick={() => onFilterChange(tb.key)}
              style={{
                backgroundColor: isActive ? 'var(--primary-accent)' : 'var(--bg-card)',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                border: `1px solid ${isActive ? 'var(--primary-accent)' : 'var(--border-color)'}`,
                padding: '6px 12px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                whiteSpace: 'nowrap',
                boxShadow: isActive ? 'var(--shadow-neon-pink)' : 'none',
              }}
            >
              {tb.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
