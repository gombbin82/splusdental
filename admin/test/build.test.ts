import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

describe('admin host', () => {
  it('blocks all crawlers', () => {
    expect(robots).toMatch(/User-agent: \*\s+Disallow: \/\s*$/);
  });

  it('marks the app noindex and loads Google sign-in', () => {
    expect(index).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(index).toContain('https://accounts.google.com/gsi/client');
  });
});
