import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inRange, toCents } from '../src/app/money';
import { initials } from '../src/app/shell-utils';
import { cardLabel, deadlineSoon } from '../src/app/payments-utils';
import {
  channelLabel,
  compact,
  delta,
  duration,
  axisScale,
  share,
  shortDate,
} from '../src/app/traffic-utils';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const robots = read('../public/robots.txt');
const shell = read('../src/layouts/AppShell.astro');
const pages = readdirSync(new URL('../src/pages', import.meta.url)).filter((f) =>
  f.endsWith('.astro'),
);

describe('admin host', () => {
  it('blocks all crawlers', () => {
    expect(robots).toMatch(/User-agent: \*\s+Disallow: \/\s*$/);
  });

  it('marks the app shell noindex and loads Google sign-in', () => {
    expect(shell).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(shell).toContain('https://accounts.google.com/gsi/client');
  });

  it('renders every page inside the app shell (or noindex on its own)', () => {
    for (const p of pages) {
      const src = read(`../src/pages/${p}`);
      const ok = src.includes('<AppShell') || src.includes('content="noindex, nofollow"');
      expect(ok, p).toBe(true);
    }
  });

  it('marks admin pages adminOnly', () => {
    for (const p of [
      'reports.astro',
      'traffic.astro',
      'settings.astro',
      'claims.astro',
      'providers.astro',
    ]) {
      expect(read(`../src/pages/${p}`), p).toMatch(/<AppShell[^>]*adminOnly/);
    }
  });

  it('signs returning users in automatically and renews before the token expires', () => {
    const src = read('../src/app/shell.ts');
    expect(src).toContain('auto_select: true');
    expect(src).toMatch(
      /show\('signin'\);\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*gsi\.accounts\.id\.prompt\(\);/,
    );
    expect(src).toContain('function scheduleRefresh');
  });

  it('does not load fonts from third parties (CSP font-src self)', () => {
    for (const p of pages) expect(read(`../src/pages/${p}`)).not.toContain('fonts.googleapis.com');
    expect(shell).not.toContain('fonts.googleapis.com');
  });
});

describe('toCents', () => {
  it('parses dollar strings', () => {
    expect(toCents('350')).toBe(35000);
    expect(toCents('$1,234.5')).toBe(123450);
    expect(toCents(' 0.50 ')).toBe(50);
  });

  it('returns null for blank and NaN for junk', () => {
    expect(toCents('')).toBeNull();
    expect(toCents('12.345')).toBeNaN();
    expect(toCents('abc')).toBeNaN();
  });

  it('checks the allowed range', () => {
    expect(inRange(49)).toBe(false);
    expect(inRange(50)).toBe(true);
    expect(inRange(1_000_000)).toBe(true);
    expect(inRange(1_000_001)).toBe(false);
  });
});

describe('initials', () => {
  it('uses first and last name', () => expect(initials('Stephanie Kang', 'x@y.z')).toBe('SK'));
  it('falls back to the email', () =>
    expect(initials('info@splus.dental', 'info@splus.dental')).toBe('I'));
  it('splits dotted emails', () => expect(initials('', 'jane.doe@x.com')).toBe('JD'));
});

describe('payments page', () => {
  it('has a Payments nav item with a held badge, visible to staff (not admin-only)', () => {
    expect(shell).toMatch(/id: 'payments', href: '\/payments'/);
    expect(shell).toContain('data-held-badge');
    expect(read('../src/pages/payments.astro')).not.toMatch(/<AppShell[^>]*adminOnly/);
  });

  it('create form holds payments by default and has an (initially hidden) email field', () => {
    const src = read('../src/pages/payment-links.astro');
    expect(src).toMatch(/name="holdForApproval" checked/);
    expect(src).toMatch(/data-email-field hidden/);
    expect(src).toContain('id="email-dialog"');
  });
});

describe('cardLabel', () => {
  it('formats brand and last4', () =>
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242'));
  it('falls back', () => {
    expect(cardLabel(null)).toBe('—');
    expect(cardLabel({ brand: null, last4: '1111' })).toBe('Card •••• 1111');
  });
});

describe('deadlineSoon', () => {
  const now = 1_700_000_000_000;
  it('is true within 48h', () => expect(deadlineSoon(now / 1000 + 47 * 3600, now)).toBe(true));
  it('is false beyond 48h', () => expect(deadlineSoon(now / 1000 + 49 * 3600, now)).toBe(false));
});

describe('traffic helpers', () => {
  it('compacts large numbers only', () => {
    expect(compact(1284)).toBe('1,284');
    expect(compact(12_900)).toBe('12.9K');
    expect(compact(1_250_000)).toBe('1.3M');
  });

  it('describes change vs the previous period', () => {
    expect(delta(150, 100)).toEqual({ text: '+50%', dir: 'up' });
    expect(delta(80, 100)).toEqual({ text: '−20%', dir: 'down' });
    expect(delta(100, 100)).toEqual({ text: 'No change', dir: 'flat' });
    expect(delta(10, 0)).toBeNull();
  });

  it('formats durations, shares, dates and axis maxima', () => {
    expect(duration(42)).toBe('42s');
    expect(duration(95.5)).toBe('1m 36s');
    expect(share(1, 3)).toBe(33);
    expect(share(5, 0)).toBe(0);
    expect(shortDate('2026-11-17')).toBe('Nov 17');
    expect(axisScale(0)).toEqual({ max: 4, step: 1 });
    expect(axisScale(29)).toEqual({ max: 30, step: 10 });
    expect(axisScale(48)).toEqual({ max: 60, step: 20 });
    expect(axisScale(120)).toEqual({ max: 150, step: 50 });
  });

  it('labels GA channels in plain words', () => {
    expect(channelLabel('Organic Search')).toBe('Search (Google, Bing…)');
    expect(channelLabel('Paid Search')).toBe('Paid Search');
  });
});
