import { describe, expect, it } from 'vitest';
import { loadConfig, stripeMode } from '../src/config.js';

describe('stripeMode', () => {
  it.each([
    ['sk_test_abc', 'test'],
    ['rk_test_abc', 'test'],
    ['sk_live_abc', 'live'],
    ['rk_live_abc', 'live'],
  ])('%s -> %s', (key, mode) => {
    expect(stripeMode(key)).toBe(mode);
  });

  it('treats a missing or unknown key as test (never claims live)', () => {
    expect(stripeMode(undefined)).toBe('test');
    expect(stripeMode('whatever')).toBe('test');
  });
});

describe('loadConfig', () => {
  it('reads runtime env with defaults', () => {
    const cfg = loadConfig({
      GOOGLE_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com',
      STRIPE_SECRET_KEY: 'sk_test_x',
    });
    expect(cfg).toEqual({
      appEnv: 'dev',
      adminHd: 'splus.dental',
      googleClientId: 'client.apps.googleusercontent.com',
      publicSiteUrl: 'http://localhost:4321',
      stripeSecretKey: 'sk_test_x',
      port: 8080,
    });
  });

  it('strips a trailing slash from PUBLIC_SITE_URL', () => {
    expect(loadConfig({ PUBLIC_SITE_URL: 'https://splus.dental/' }).publicSiteUrl).toBe(
      'https://splus.dental',
    );
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => loadConfig({ APP_ENV: 'qa' })).toThrow(/APP_ENV/);
  });

  it('refuses a live Stripe key outside prod', () => {
    expect(() => loadConfig({ APP_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_live_x' })).toThrow(
      /live/,
    );
  });
});
