// Pure helpers for the traffic page (unit-tested in test/build.test.ts).

/** 1,284 / 12.9K / 1.2M */
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return Math.round(n).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    n,
  );
}

/** Change vs the previous period. null when there's nothing to compare against. */
export function delta(
  current: number,
  previous: number,
): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: 'No change', dir: 'flat' };
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' };
}

/** 95.5 → "1m 36s" */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Share of a total as a whole percent; 0 for an empty total. */
export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** "2026-11-17" → "Nov 17" (date only; no time zone conversion). */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Y axis with round steps (1, 2, 5 × 10ⁿ) and about four gridlines; at least 0–4. */
export function axisScale(max: number): { max: number; step: number } {
  if (max <= 4) return { max: 4, step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  return { max: step * Math.ceil(max / step), step };
}

const DEVICE: Record<string, string> = { mobile: 'Phone', desktop: 'Computer', tablet: 'Tablet' };
export const deviceLabel = (d: string) => DEVICE[d] ?? d;

const CHANNEL: Record<string, string> = {
  'Organic Search': 'Search (Google, Bing…)',
  Direct: 'Typed the address or bookmark',
  Referral: 'Links on other websites',
  'Organic Social': 'Social media',
  'Organic Maps': 'Google Maps',
  Unassigned: 'Other',
};
export const channelLabel = (c: string) => CHANNEL[c] ?? c;
