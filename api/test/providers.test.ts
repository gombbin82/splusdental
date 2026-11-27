// Provider records against a real (in-memory) Postgres via PGlite. All values invented.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type OpenedDb } from '../src/db/index.js';
import { isValidNpi } from '../src/providers.js';
import { ADMIN_TOKEN, authHeaders, testApp } from './helpers/app.js';

const ORG = {
  kind: 'organization',
  orgName: 'Test Practice PLLC',
  npi: '2234567891',
  taxId: '12-3456789',
  taxonomy: '1223g0001x',
  address1: '100 Example Ave',
  city: 'Mountlake Terrace',
  state: 'wa',
  zip: '98043-1234',
};
const DENTIST = {
  kind: 'person',
  firstName: 'Alex',
  lastName: 'Smith',
  credential: 'DDS',
  role: 'dentist',
  npi: '1245319599',
  taxonomy: '1223G0001X',
};

let opened: OpenedDb;
beforeAll(async () => {
  opened = (await openDb({ databaseUrl: '', appEnv: 'dev', pgliteDir: ':memory:' }))!;
});
afterAll(() => opened.close());

const app = () => testApp(undefined, undefined, { db: opened.db });
const admin = (extra: Record<string, string> = {}) =>
  authHeaders({ 'Content-Type': 'application/json', ...extra }, ADMIN_TOKEN);
const send = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = admin(),
) =>
  app().request(`/api/admin/providers${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('isValidNpi', () => {
  it('checks the Luhn digit', () => {
    expect(isValidNpi('1245319599')).toBe(true);
    expect(isValidNpi('2234567891')).toBe(true);
    expect(isValidNpi('1245319590')).toBe(false);
  });
});

describe('/api/admin/providers', () => {
  it('is admin only', async () => {
    const staff = await send('GET', '', undefined, authHeaders());
    expect(staff.status).toBe(403);
    expect((await send('GET', '', undefined, {})).status).toBe(401);
  });

  it('answers 503 without a database', async () => {
    const res = await testApp().request('/api/admin/providers', { headers: admin() });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'db_disabled' });
  });

  it('creates, lists, updates and deletes', async () => {
    const created = await send('POST', '', ORG);
    expect(created.status).toBe(201);
    const org = await created.json();
    expect(org).toMatchObject({
      kind: 'organization',
      npi: '2234567891',
      taxId: '123456789',
      taxonomy: '1223G0001X',
      state: 'WA',
      zip: '980431234',
      firstName: null,
      updatedBy: 'owner@splus.dental',
    });

    const d = await (await send('POST', '', DENTIST)).json();
    expect(d).toMatchObject({ kind: 'person', role: 'dentist', orgName: null });

    const list = await (await send('GET', '')).json();
    expect(list.providers.map((p: { npi: string }) => p.npi)).toEqual(['2234567891', '1245319599']);

    const upd = await send('PUT', `/${d.id}`, { ...DENTIST, credential: 'DMD' });
    expect(upd.status).toBe(200);
    expect((await upd.json()).credential).toBe('DMD');

    expect((await send('DELETE', `/${d.id}`)).status).toBe(204);
    expect((await send('DELETE', `/${d.id}`)).status).toBe(404);
    expect((await send('DELETE', `/${org.id}`)).status).toBe(204);
  });

  it('rejects a duplicate NPI', async () => {
    const first = await (await send('POST', '', DENTIST)).json();
    const dup = await send('POST', '', { ...DENTIST, firstName: 'Other' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: 'duplicate_npi' });
    await send('DELETE', `/${first.id}`);
  });

  it('validates by kind and reports field messages', async () => {
    const res = await send('POST', '', { kind: 'organization', npi: '1245319599', zip: '98043' });
    expect(res.status).toBe(400);
    const { fields } = await res.json();
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(['orgName', 'taxId', 'address1', 'city', 'state', 'zip']),
    );
    // The first digit doesn't tell organization from person: a 1… NPI is fine for a practice.
    expect(fields.npi).toBeUndefined();
    const bad = await send('POST', '', { ...DENTIST, npi: '1245319590' });
    expect((await bad.json()).fields.npi).toBe('Not a valid NPI');
  });

  it('404s an unknown id and 400s a malformed one', async () => {
    expect((await send('PUT', '/00000000-0000-4000-8000-000000000000', DENTIST)).status).toBe(404);
    expect((await send('DELETE', '/nope')).status).toBe(400);
  });
});
