import React, { useState } from 'react';
import type { Lang, LogEntry, LogLevel } from '../shared/types';
import { getT } from '../shared/i18n';
import { toCsv } from '../shared/utils';
import { FileDown, FileText, Terminal } from 'lucide-react';

interface ActivityLogProps {
  logs: LogEntry[];
  lang: Lang;
}

export const ActivityLog: React.FC<ActivityLogProps> = ({ logs, lang }) => {
  const t = getT(lang);
  const [filterLevel, setFilterLevel] = useState<string>('all');

  const filteredLogs = logs.filter((l) => {
    if (filterLevel === 'all') return true;
    return l.level === filterLevel;
  });

  const handleExportCsv = () => {
    const csv = toCsv(
      logs.map((l) => ({
        id: l.id,
        timestamp: new Date(l.ts).toISOString(),
        level: l.level,
        message: l.message,
        videoId: l.videoId || '',
        action: l.action || '',
        account: l.account || '',
      })),
      ['id', 'timestamp', 'level', 'message', 'videoId', 'action', 'account']
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tiktok-cleaner-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const json = JSON.stringify(logs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tiktok-cleaner-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case 'success':
        return 'var(--success-color)';
      case 'error':
        return 'var(--danger-color)';
      case 'warn':
        return 'var(--warning-color)';
      default:
        return 'var(--secondary-accent)';
    }
  };

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
        gap: '12px',
      }}
    >
      {/* Top Header with Filters & Export */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={16} color="var(--primary-accent)" />
          <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t.activityLog} ({logs.length})
          </h4>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Level Filter */}
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            style={{
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '11px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Levels</option>
            <option value="success">Success Only</option>
            <option value="error">Errors Only</option>
            <option value="warn">Warnings Only</option>
            <option value="info">Info Only</option>
          </select>

          {/* Export buttons */}
          <button
            className="btn-secondary"
            onClick={handleExportCsv}
            disabled={logs.length === 0}
            title={t.exportCsv}
            style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '8px' }}
          >
            <FileDown size={13} />
            <span>CSV</span>
          </button>
          <button
            className="btn-secondary"
            onClick={handleExportJson}
            disabled={logs.length === 0}
            title={t.exportJson}
            style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '8px' }}
          >
            <FileText size={13} />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* Log Console View */}
      <div
        style={{
          maxHeight: '220px',
          overflowY: 'auto',
          backgroundColor: '#0a0b0e',
          borderRadius: '12px',
          padding: '12px',
          fontSize: '11px',
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            No log entries yet.
          </div>
        ) : (
          filteredLogs.slice().reverse().map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: '8px', lineHeight: '1.4' }}>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              <span style={{ color: getLevelColor(l.level), fontWeight: 700, flexShrink: 0 }}>
                [{l.level.toUpperCase()}]
              </span>
              <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                {l.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
