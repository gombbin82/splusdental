// Real Postgres (node-postgres driver, advisory-locked migrations). Runs only with
// TEST_DATABASE_URL, e.g. a throwaway `docker run postgres:16`. Values are fake.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { applySeed, parseSeed } from '../src/db/seed.js';
import { ADMIN_TOKEN, authHeaders, testApp } from './helpers/app.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Postgres (TEST_DATABASE_URL)', () => {
  it('migrates concurrently, seeds, and serves CRUD', async () => {
    // Two instances starting at once, like Cloud Run scaling out.
    const [a, b] = await Promise.all([
      openDb({ databaseUrl: url!, appEnv: 'staging' }),
      openDb({ databaseUrl: url!, appEnv: 'staging' }),
    ]);
    try {
      expect(a!.driver).toBe('postgres');
      const seed = parseSeed(
        readFileSync(new URL('../seed.example.json', import.meta.url), 'utf8'),
      );
      const first = await applySeed(a!.db, seed);
      expect(await applySeed(b!.db, seed)).toEqual({ providers: 0, locations: 0, payers: 0 });
      expect(first.providers + first.locations + first.payers).toBeGreaterThanOrEqual(0);

      const app = testApp(undefined, undefined, { db: b!.db });
      const headers = authHeaders({ 'Content-Type': 'application/json' }, ADMIN_TOKEN);
      const payers = await (await app.request('/api/admin/payers', { headers })).json();
      const payer = payers.payers.find((p: { payerId: string }) => p.payerId === '00000');
      const res = await app.request('/api/admin/patients', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          firstName: 'Test',
          lastName: 'Person',
          birthDate: '1990-01-01',
          coverage: { payerId: payer.id, relationship: '18', memberId: 'M1' },
        }),
      });
      expect(res.status).toBe(201);
      const pt = await res.json();
      expect(pt.coverage.subscriberId).toBe(pt.id);
      const inUse = await app.request(`/api/admin/payers/${payer.id}`, {
        method: 'DELETE',
        headers,
      });
      expect(inUse.status).toBe(409);
      const del = await app.request(`/api/admin/patients/${pt.id}`, { method: 'DELETE', headers });
      expect(del.status).toBe(204);
    } finally {
      await a?.close();
      await b?.close();
    }
  });
});
