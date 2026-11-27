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
      adminEmails: [],
      staffEmails: [],
      googleClientId: 'client.apps.googleusercontent.com',
      publicSiteUrl: 'http://localhost:4321',
      stripeSecretKey: 'sk_test_x',
      gmailSender: '',
      runtimeSaEmail: '',
      ga4PropertyId: '',
      databaseUrl: '',
      seedJson: '',
      port: 8080,
    });
  });

  it('accepts only a numeric GA4_PROPERTY_ID', () => {
    expect(loadConfig({ GA4_PROPERTY_ID: ' 123456789 ' }).ga4PropertyId).toBe('123456789');
    expect(loadConfig({ GA4_PROPERTY_ID: 'G-XT2LGD6KEM' }).ga4PropertyId).toBe('');
    expect(loadConfig({ GA4_PROPERTY_ID: '123/../x' }).ga4PropertyId).toBe('');
  });

  it('reads GMAIL_SENDER (trimmed, lower-cased) and RUNTIME_SA_EMAIL', () => {
    const cfg = loadConfig({
      GMAIL_SENDER: ' Info@Splus.Dental ',
      RUNTIME_SA_EMAIL: 'sa@p.iam.gserviceaccount.com',
    });
    expect(cfg.gmailSender).toBe('info@splus.dental');
    expect(cfg.runtimeSaEmail).toBe('sa@p.iam.gserviceaccount.com');
  });

  it('parses email allowlists: comma/space separated, lower-cased, de-duplicated', () => {
    const cfg = loadConfig({
      ADMIN_EMAILS: ' Owner@Splus.Dental, someone@gmail.com ,owner@splus.dental',
      STAFF_EMAILS: 'info@splus.dental\nfront@splus.dental',
    });
    expect(cfg.adminEmails).toEqual(['owner@splus.dental', 'someone@gmail.com']);
    expect(cfg.staffEmails).toEqual(['info@splus.dental', 'front@splus.dental']);
  });

  it('trims whitespace/newlines around STRIPE_SECRET_KEY', () => {
    expect(loadConfig({ STRIPE_SECRET_KEY: 'rk_test_abc\n' }).stripeSecretKey).toBe('rk_test_abc');
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
