/** Lower-case, strip Vietnamese/latin diacritics, collapse whitespace. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVideoHref(href: string | null | undefined): { author: string; mediaType: 'video' | 'photo'; videoId: string } | null {
  if (!href) return null;
  const m = href.match(/\/@([^/?#]+)\/(video|photo)\/(\d{6,})/);
  if (!m) return null;
  return { author: decodeURIComponent(m[1]), mediaType: m[2] as 'video' | 'photo', videoId: m[3] };
}

/** Parses TikTok compact counters like "1.2K", "3,4M", "987". */
export function parseCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.trim().replace(/\s/g, '').toUpperCase();
  const m = t.match(/^([\d.,]+)([KMB])?$/);
  if (!m) return null;
  let numStr = m[1];
  if (m[2]) numStr = numStr.replace(',', '.');
  else numStr = numStr.replace(/[.,]/g, '');
  const n = parseFloat(numStr);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === 'K' ? 1e3 : m[2] === 'M' ? 1e6 : m[2] === 'B' ? 1e9 : 1;
  return Math.round(n * mult);
}

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function videoKey(kind: string, videoId: string) {
  return `${kind}:${videoId}`;
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(',')).join('\r\n');
  return '\uFEFF' + head + '\r\n' + body;
}
