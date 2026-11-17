import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createGoogleVerifier, requireStaff, type StaffEnv } from '../src/auth.js';
import { CLIENT_ID, signIdToken, testOAuthClient } from './helpers/google-token.js';

function appWithAuth() {
  const verify = createGoogleVerifier(CLIENT_ID, testOAuthClient());
  const app = new Hono<StaffEnv>();
  app.use('/admin/*', requireStaff({ verify, adminHd: 'splus.dental' }));
  app.get('/admin/me', (c) => c.json(c.get('staff')));
  return app;
}

const call = (token?: string) =>
  appWithAuth().request('/admin/me', {
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });

describe('requireStaff', () => {
  it('accepts a valid, verified @splus.dental token', async () => {
    const res = await call(signIdToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'staff@splus.dental', name: 'Test Staff' });
  });

  it('401 when the Authorization header is missing', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Bearer/);
  });

  it('401 for a non-Bearer Authorization header', async () => {
    const res = await appWithAuth().request('/admin/me', {
      headers: { Authorization: 'Basic abc' },
    });
    expect(res.status).toBe(401);
  });

  it('401 for a garbage token', async () => {
    expect((await call('not-a-jwt')).status).toBe(401);
  });

  it('401 for a token signed with the wrong key', async () => {
    expect((await call(signIdToken({}, { wrongKey: true }))).status).toBe(401);
  });

  it('401 for a token issued to another OAuth client (bad audience)', async () => {
    const token = signIdToken({ aud: 'someone-else.apps.googleusercontent.com' });
    expect((await call(token)).status).toBe(401);
  });

  it('401 for an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await call(signIdToken({ iat: now - 7200, exp: now - 3600 }))).status).toBe(401);
  });

  it('401 for a token from a non-Google issuer', async () => {
    expect((await call(signIdToken({ iss: 'https://evil.example' }))).status).toBe(401);
  });

  it('403 for a different Workspace domain', async () => {
    const res = await call(signIdToken({ hd: 'example.com', email: 'x@example.com' }));
    expect(res.status).toBe(403);
  });

  it('403 for a consumer account without hd even if the email looks right', async () => {
    const res = await call(signIdToken({ hd: undefined, email: 'staff@splus.dental' }));
    expect(res.status).toBe(403);
  });

  it('403 when email_verified is not true', async () => {
    expect((await call(signIdToken({ email_verified: false }))).status).toBe(403);
    expect((await call(signIdToken({ email_verified: 'true' }))).status).toBe(403);
  });
});
