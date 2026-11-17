import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createGoogleVerifier, requireAdmin, requireStaff, roleFor, type StaffEnv } from '../src/auth.js';
import { CLIENT_ID, signIdToken, testOAuthClient } from './helpers/google-token.js';

function appWithAuth() {
  const verify = createGoogleVerifier(CLIENT_ID, testOAuthClient());
  const app = new Hono<StaffEnv>();
  app.use(
    '/admin/*',
    requireStaff({
      verify,
      adminEmails: ['owner@splus.dental', 'maintainer@gmail.com'],
      staffEmails: ['staff@splus.dental'],
    }),
  );
  app.get('/admin/me', (c) => c.json(c.get('staff')));
  app.get('/admin/only', requireAdmin, (c) => c.json({ ok: true }));
  return app;
}

const call = (token?: string) =>
  appWithAuth().request('/admin/me', {
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });

describe('requireStaff', () => {
  it('accepts a listed staff email as staff', async () => {
    const res = await call(signIdToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: 'staff@splus.dental',
      name: 'Test Staff',
      role: 'staff',
    });
  });

  it('accepts a listed admin email as admin, case-insensitively', async () => {
    const res = await call(signIdToken({ email: 'Owner@Splus.Dental' }));
    expect(await res.json()).toMatchObject({ email: 'owner@splus.dental', role: 'admin' });
  });

  it('accepts a listed consumer (non-Workspace) admin account', async () => {
    const res = await call(signIdToken({ email: 'maintainer@gmail.com', hd: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'admin' });
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

  it('403 for a verified @splus.dental account that is not on either list', async () => {
    const res = await call(signIdToken({ email: 'newhire@splus.dental' }));
    expect(res.status).toBe(403);
  });

  it('403 for an unlisted outside account', async () => {
    const res = await call(signIdToken({ hd: 'example.com', email: 'x@example.com' }));
    expect(res.status).toBe(403);
  });

  it('403 when the token has no email', async () => {
    expect((await call(signIdToken({ email: undefined }))).status).toBe(403);
  });

  it('403 when email_verified is not true', async () => {
    expect((await call(signIdToken({ email_verified: false }))).status).toBe(403);
    expect((await call(signIdToken({ email_verified: 'true' }))).status).toBe(403);
  });
});

describe('requireAdmin', () => {
  const callOnly = (token: string) =>
    appWithAuth().request('/admin/only', { headers: { Authorization: `Bearer ${token}` } });

  it('lets admins through', async () => {
    expect((await callOnly(signIdToken({ email: 'owner@splus.dental' }))).status).toBe(200);
  });

  it('403 for staff', async () => {
    expect((await callOnly(signIdToken())).status).toBe(403);
  });
});

describe('roleFor', () => {
  const lists = { adminEmails: ['a@x.com'], staffEmails: ['a@x.com', 's@x.com'] };
  it('admin wins when on both lists', () => expect(roleFor('A@x.com', lists)).toBe('admin'));
  it('staff when only on staff list', () => expect(roleFor('s@x.com', lists)).toBe('staff'));
  it('null when on neither (or lists empty)', () => {
    expect(roleFor('z@x.com', lists)).toBeNull();
    expect(roleFor('a@x.com', { adminEmails: [], staffEmails: [] })).toBeNull();
  });
});
