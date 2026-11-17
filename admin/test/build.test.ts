import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inRange, toCents } from '../src/app/money';
import { initials } from '../src/app/shell-utils';

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
    for (const p of ['reports.astro', 'traffic.astro', 'settings.astro']) {
      expect(read(`../src/pages/${p}`), p).toMatch(/<AppShell[^>]*adminOnly/);
    }
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
