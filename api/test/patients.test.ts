// Payers, patients and coverage against in-memory Postgres (PGlite). All people invented.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type OpenedDb } from '../src/db/index.js';
import { setLogSink } from '../src/log.js';
import { ADMIN_TOKEN, authHeaders, testApp } from './helpers/app.js';

let opened: OpenedDb;
beforeAll(async () => {
  opened = (await openDb({ databaseUrl: '', appEnv: 'dev', pgliteDir: ':memory:' }))!;
});
afterAll(() => opened.close());

const app = () => testApp(undefined, undefined, { db: opened.db });
const call = async (method: string, path: string, body?: unknown, token = ADMIN_TOKEN) => {
  const res = await app().request(`/api/admin${path}`, {
    method,
    headers: authHeaders({ 'Content-Type': 'application/json' }, token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

const PARENT = {
  firstName: 'Jane',
  lastName: 'Doe',
  birthDate: '1980-02-03',
  sex: 'female',
  address1: '1 Main St',
  city: 'Seattle',
  state: 'wa',
  zip: '98101',
};

describe('payers', () => {
  it('is admin only', async () => {
    const { status } = await app().request('/api/admin/payers', { headers: authHeaders() });
    expect(status).toBe(403);
  });

  it('creates and validates', async () => {
    const bad = await call('POST', '/payers', { name: '', payerId: '' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields)).toEqual(['name', 'payerId']);
    const ok = await call('POST', '/payers', {
      name: 'Test Dental',
      payerId: 'td123',
      filingIndicator: '12',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ payerId: 'TD123', filingIndicator: '12', active: true });
    await call('DELETE', `/payers/${ok.body.id}`);
  });
});

describe('patients and coverage', () => {
  it('creates a self-subscribed patient with coverage', async () => {
    const payer = (await call('POST', '/payers', { name: 'Self Plan', payerId: 'S1' })).body;
    const res = await call('POST', '/patients', {
      ...PARENT,
      chartNumber: 'T100',
      coverage: { payerId: payer.id, relationship: '18', memberId: 'M1', groupNumber: 'G1' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ state: 'WA', chartNumber: 'T100' });
    expect(res.body.coverage).toEqual({
      payerId: payer.id,
      relationship: '18',
      subscriberId: res.body.id,
      memberId: 'M1',
      groupNumber: 'G1',
      groupName: null,
    });

    // Deleting a self-subscribed patient takes their coverage with them.
    expect((await call('DELETE', `/patients/${res.body.id}`)).status).toBe(204);
    expect((await call('DELETE', `/payers/${payer.id}`)).status).toBe(204);
  });

  it('links a dependent to a subscriber and protects both ends', async () => {
    const payer = (await call('POST', '/payers', { name: 'Family Plan', payerId: 'F1' })).body;
    const parent = (await call('POST', '/patients', PARENT)).body;
    const child = await call('POST', '/patients', {
      ...PARENT,
      firstName: 'Kid',
      birthDate: '2015-06-07',
      sex: 'male',
      coverage: { payerId: payer.id, relationship: '19', subscriberId: parent.id, memberId: 'M2' },
    });
    expect(child.status).toBe(201);
    expect(child.body.coverage.subscriberId).toBe(parent.id);

    const list = (await call('GET', '/patients')).body.patients;
    expect(list.map((p: { firstName: string }) => p.firstName)).toEqual(['Jane', 'Kid']);

    // Can't delete the subscriber or the payer while the child's coverage uses them.
    expect(await call('DELETE', `/patients/${parent.id}`)).toEqual({
      status: 409,
      body: { error: 'in_use' },
    });
    expect(await call('DELETE', `/payers/${payer.id}`)).toEqual({
      status: 409,
      body: { error: 'in_use' },
    });

    // Removing the coverage frees them.
    const upd = await call('PUT', `/patients/${child.body.id}`, {
      ...PARENT,
      firstName: 'Kid',
      coverage: null,
    });
    expect(upd.body.coverage).toBeNull();
    expect((await call('DELETE', `/patients/${parent.id}`)).status).toBe(204);
    await call('DELETE', `/patients/${child.body.id}`);
    await call('DELETE', `/payers/${payer.id}`);
  });

  it('validates coverage', async () => {
    const res = await call('POST', '/patients', {
      ...PARENT,
      birthDate: '2999-01-01',
      coverage: { payerId: 'nope', relationship: '19', memberId: '' },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields)).toEqual(
      expect.arrayContaining([
        'birthDate',
        'coverage.payerId',
        'coverage.memberId',
        'coverage.subscriberId',
      ]),
    );
  });

  it('rejects unknown payer/subscriber ids and duplicate chart numbers', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const before = (await call('GET', '/patients')).body.patients.length;
    const res = await call('POST', '/patients', {
      ...PARENT,
      coverage: { payerId: missing, relationship: '18', memberId: 'M' },
    });
    expect(res).toEqual({ status: 400, body: { error: 'invalid_reference' } });
    // The transaction rolled back: no half-saved patient.
    expect((await call('GET', '/patients')).body.patients).toHaveLength(before);

    const a = (await call('POST', '/patients', { ...PARENT, chartNumber: 'DUP' })).body;
    expect(await call('POST', '/patients', { ...PARENT, chartNumber: 'DUP' })).toEqual({
      status: 409,
      body: { error: 'duplicate_chart' },
    });
    await call('DELETE', `/patients/${a.id}`);
  });

  it('never logs patient values, even when the database fails', async () => {
    const lines: string[] = [];
    const prev = setLogSink((l) => lines.push(l));
    try {
      // Force a database error by closing a private copy of the DB.
      const broken = (await openDb({ databaseUrl: '', appEnv: 'dev', pgliteDir: ':memory:' }))!;
      await broken.close();
      const res = await testApp(undefined, undefined, { db: broken.db }).request(
        '/api/admin/patients',
        {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }, ADMIN_TOKEN),
          body: JSON.stringify({ ...PARENT, firstName: 'Zebulon', chartNumber: 'SECRET-77' }),
        },
      );
      expect(res.status).toBeGreaterThanOrEqual(500);
      await call('POST', '/patients', { ...PARENT, firstName: 'Quintessa' }).then((r) =>
        call('DELETE', `/patients/${r.body.id}`),
      );
    } finally {
      setLogSink(prev);
    }
    const all = lines.join('\n');
    for (const v of ['Zebulon', 'SECRET-77', 'Quintessa', 'Doe', '1980-02-03', '1 Main St']) {
      expect(all).not.toContain(v);
    }
    expect(all).toContain('patient.created');
  });
});
