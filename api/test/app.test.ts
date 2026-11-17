import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLogSink, type LogSink } from '../src/log.js';
import { ADMIN_TOKEN, TEST_CONFIG, authHeaders, testApp } from './helpers/app.js';

let lines: string[];
let prevSink: LogSink;
beforeEach(() => {
  lines = [];
  prevSink = setLogSink((l) => lines.push(l));
});
afterEach(() => {
  setLogSink(prevSink);
});

describe('GET /api/config', () => {
  it('returns public client config', async () => {
    const res = await testApp().request('/api/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      googleClientId: TEST_CONFIG.googleClientId,
      stripeMode: 'test',
      env: 'staging',
    });
  });

  it('reports live mode for a live key in prod', async () => {
    const res = await testApp(undefined, {
      ...TEST_CONFIG,
      appEnv: 'prod',
      stripeSecretKey: 'rk_live_x',
    }).request('/api/config');
    expect(await res.json()).toMatchObject({ stripeMode: 'live', env: 'prod' });
  });
});

describe('GET /api/me', () => {
  it('401 without a token', async () => {
    expect((await testApp().request('/api/me')).status).toBe(401);
  });

  it('returns the signed-in staff member', async () => {
    const res = await testApp().request('/api/me', { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: 'frontdesk@splus.dental',
      name: 'Front Desk',
      role: 'staff',
    });
  });

  it('reports the admin role for an admin', async () => {
    const res = await testApp().request('/api/me', { headers: authHeaders({}, ADMIN_TOKEN) });
    expect(await res.json()).toMatchObject({ email: 'owner@splus.dental', role: 'admin' });
  });
});

describe('GET /api/admin/settings (admin only)', () => {
  it('401 without a token', async () => {
    expect((await testApp().request('/api/admin/settings')).status).toBe(401);
  });

  it('403 for staff', async () => {
    const res = await testApp().request('/api/admin/settings', { headers: authHeaders() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'admin_only' });
  });

  it('200 for an admin, without exposing emails or secrets', async () => {
    const res = await testApp().request('/api/admin/settings', {
      headers: authHeaders({}, ADMIN_TOKEN),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      env: 'staging',
      stripeMode: 'test',
      publicSiteUrl: 'https://staging.splus.dental',
      adminCount: 1,
      staffCount: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/@|sk_/);
  });
});

describe('staff can use payment links', () => {
  it('lists links as staff', async () => {
    const res = await testApp().request('/api/payment-links', { headers: authHeaders() });
    expect(res.status).toBe(200);
  });
});

describe('admin routes require auth', () => {
  it.each([
    ['GET', '/api/payment-links'],
    ['POST', '/api/payment-links'],
    ['POST', '/api/payment-links/plink_1/deactivate'],
  ])('%s %s -> 401', async (method, path) => {
    expect((await testApp().request(path, { method })).status).toBe(401);
  });
});

describe('hardening', () => {
  it('sets security headers and no-store on API responses', async () => {
    const res = await testApp().request('/api/healthz');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects cross-site browser requests', async () => {
    const res = await testApp().request('/api/me', {
      headers: authHeaders({ 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows same-origin browser requests', async () => {
    const res = await testApp().request('/api/me', {
      headers: authHeaders({ 'Sec-Fetch-Site': 'same-origin' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects CORS preflight', async () => {
    const res = await testApp().request('/api/payment-links', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await testApp().request('/api/payment-links', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ description: 'x'.repeat(64 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await testApp().request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('logs requests as JSON with severity and without the Authorization header', async () => {
    await testApp().request('/api/me', { headers: authHeaders() });
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.message === 'request');
    expect(entry).toMatchObject({
      severity: 'INFO',
      httpRequest: { requestMethod: 'GET', requestUrl: '/api/me', status: 200 },
    });
    expect(lines.join('\n')).not.toContain('good-token');
  });
});
