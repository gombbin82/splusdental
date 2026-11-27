// Seed file shape and idempotent apply, against in-memory PGlite. Values are fake.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type OpenedDb } from '../src/db/index.js';
import { applySeed, seedFile } from '../src/db/seed.js';
import { listLocations } from '../src/locations.js';
import { listPayers } from '../src/payers.js';
import { listProviders } from '../src/providers.js';
import { ADMIN_TOKEN, authHeaders, testApp } from './helpers/app.js';

const example = JSON.parse(readFileSync(new URL('../seed.example.json', import.meta.url), 'utf8'));

let opened: OpenedDb;
beforeAll(async () => {
  opened = (await openDb({ databaseUrl: '', appEnv: 'dev', pgliteDir: ':memory:' }))!;
});
afterAll(() => opened.close());

describe('seed file', () => {
  it('the committed example is valid', () => {
    expect(seedFile.safeParse(example).success).toBe(true);
  });

  it('has no place for patient data', () => {
    const withPatients = { ...example, patients: [{ firstName: 'X' }] };
    expect(seedFile.safeParse(withPatients).success).toBe(false);
  });

  it('applies once and never overwrites edits', async () => {
    const seed = seedFile.parse(example);
    expect(await applySeed(opened.db, seed)).toEqual({ providers: 2, locations: 1, payers: 1 });
    expect(await applySeed(opened.db, seed)).toEqual({ providers: 0, locations: 0, payers: 0 });
    const provs = await listProviders(opened.db);
    expect(provs.map((p) => p.updatedBy)).toEqual(['seed', 'seed']);
    expect((await listLocations(opened.db))[0]).toMatchObject({ zip: '98101', state: 'WA' });
    expect((await listPayers(opened.db))[0]).toMatchObject({ payerId: '00000' });
  });
});

describe('/api/admin/locations', () => {
  const call = (method: string, path = '', body?: unknown, token = ADMIN_TOKEN) =>
    testApp(undefined, undefined, { db: opened.db }).request(`/api/admin/locations${path}`, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json' }, token),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  it('is admin only', async () => {
    expect((await call('GET', '', undefined, 'good-token')).status).toBe(403);
  });

  it('creates, validates, updates and deletes', async () => {
    const bad = await call('POST', '', { name: '', zip: '1' });
    expect(Object.keys((await bad.json()).fields)).toEqual(
      expect.arrayContaining(['name', 'address1', 'city', 'state', 'zip']),
    );
    const res = await call('POST', '', {
      name: 'Second Office',
      address1: '2 Side St',
      city: 'Lynnwood',
      state: 'wa',
      zip: '98036',
    });
    expect(res.status).toBe(201);
    const loc = await res.json();
    expect(loc.state).toBe('WA');
    const upd = await call('PUT', `/${loc.id}`, { ...loc, phone: '425-555-0100' });
    expect((await upd.json()).phone).toBe('4255550100');
    expect((await call('DELETE', `/${loc.id}`)).status).toBe(204);
  });
});

describe('parseSeed', () => {
  it('reports field paths, never values', async () => {
    const { parseSeed } = await import('../src/db/seed.js');
    expect(() => parseSeed('{', 'SEED_JSON')).toThrow('SEED_JSON is not valid JSON');
    const bad = JSON.stringify({
      providers: [{ kind: 'person', npi: '1111111111', firstName: 'Zed' }],
    });
    let msg = '';
    try {
      parseSeed(bad, 'SEED_JSON');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('providers.0.npi');
    expect(msg).not.toContain('1111111111');
    expect(msg).not.toContain('Zed');
  });
});
