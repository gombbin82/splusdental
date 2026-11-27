// Database connection. Same approach as kiwidental:
// - DATABASE_URL set (Cloud SQL): node-postgres.
// - Local dev without it: Postgres in-process via PGlite, persisted to api/.data/pg.
// - Staging/prod without it: no database (routes that need one answer 503), so Cloud Run never
//   writes to a throwaway container disk.
// Migrations in api/drizzle run on startup.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { acquireLock } from './lock.js';
import * as schema from './schema.js';

/** One query API for both drivers. */
export type Db = PgliteDatabase<typeof schema>;

const here = path.dirname(fileURLToPath(import.meta.url));
/** api/drizzle, from src/db (tsx) or dist/db (built). */
export const MIGRATIONS = path.resolve(here, '../../drizzle');

/** Arbitrary app-wide key for pg_advisory_lock around migrations. */
const MIGRATION_LOCK = 5_170_837;

export interface OpenDbOptions {
  databaseUrl: string;
  appEnv: 'dev' | 'staging' | 'prod';
  /** PGlite data folder; ':memory:' for tests. */
  pgliteDir?: string;
}

export interface OpenedDb {
  db: Db;
  driver: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

export async function openDb(opts: OpenDbOptions): Promise<OpenedDb | null> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 5 });
    // Cloud Run can start several instances at once: one migrates, the others wait on the lock.
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
      await migratePg(drizzlePg(client, { schema }), { migrationsFolder: MIGRATIONS });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
      client.release();
    }
    const db = drizzlePg(pool, { schema });
    return { db: db as unknown as Db, driver: 'postgres', close: () => pool.end() };
  }
  if (opts.appEnv !== 'dev') return null;

  const dir = opts.pgliteDir ?? path.resolve(here, '../../.data/pg');
  let client: PGlite;
  let release = () => {};
  if (dir === ':memory:') client = new PGlite();
  else {
    mkdirSync(path.dirname(dir), { recursive: true });
    release = await acquireLock(`${dir}.lock`);
    client = new PGlite(dir);
  }
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return {
    db,
    driver: 'pglite',
    close: async () => {
      await client.close();
      release();
    },
  };
}
