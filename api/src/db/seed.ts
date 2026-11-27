// Local sample data: practice records (providers, locations, insurance companies) so a fresh dev
// database doesn't have to be typed in again. Read from a git-ignored JSON file and applied on dev
// startup. Only adds what's missing; never overwrites edits made in the admin.
//
// NEVER put patient data in a seed file: no patients, subscribers, member IDs or group numbers.
// The schema below has no place for them, and unknown keys are rejected.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { locationInput } from '../locations.js';
import { payerInput } from '../payers.js';
import { providerInput } from '../providers.js';
import type { Db } from './index.js';
import { locations, payers, providers } from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** api/seed.local.json (git-ignored). `api/seed.example.json` shows the shape with fake values. */
export const SEED_FILE = path.resolve(here, '../../seed.local.json');

export const seedFile = z
  .object({
    providers: z.array(providerInput).default([]),
    locations: z.array(locationInput).default([]),
    payers: z.array(payerInput).default([]),
  })
  .strict();

export type SeedFile = z.output<typeof seedFile>;

export interface SeedResult {
  providers: number;
  locations: number;
  payers: number;
}

const BY = 'seed';

export async function applySeed(db: Db, seed: SeedFile): Promise<SeedResult> {
  const added: SeedResult = { providers: 0, locations: 0, payers: 0 };
  for (const p of seed.providers) {
    const person = p.kind === 'person';
    const rows = await db
      .insert(providers)
      .values({
        kind: p.kind,
        orgName: person ? null : p.orgName,
        firstName: person ? p.firstName : null,
        lastName: person ? p.lastName : null,
        credential: person ? p.credential : null,
        role: person ? (p.role ?? 'dentist') : null,
        npi: p.npi,
        taxId: p.taxId,
        taxonomy: p.taxonomy,
        address1: p.address1,
        address2: p.address2,
        city: p.city,
        state: p.state,
        zip: p.zip,
        phone: p.phone,
        active: p.active,
        createdBy: BY,
        updatedBy: BY,
      })
      .onConflictDoNothing({ target: providers.npi })
      .returning({ id: providers.id });
    added.providers += rows.length;
  }
  for (const l of seed.locations) {
    const found = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.name, l.name));
    if (found.length) continue;
    await db.insert(locations).values({ ...l, createdBy: BY, updatedBy: BY });
    added.locations++;
  }
  for (const y of seed.payers) {
    const found = await db
      .select({ id: payers.id })
      .from(payers)
      .where(and(eq(payers.name, y.name), eq(payers.payerId, y.payerId)));
    if (found.length) continue;
    await db.insert(payers).values({ ...y, createdBy: BY, updatedBy: BY });
    added.payers++;
  }
  return added;
}

/** Validate seed JSON text. Throws with field paths (never values) if invalid. */
export function parseSeed(text: string, source = 'seed'): SeedFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  const parsed = seedFile.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid ${source}: ${where}`);
  }
  return parsed.data;
}

/** The local seed file, or null when there isn't one. */
export function readSeedFile(file = SEED_FILE): SeedFile | null {
  if (!existsSync(file)) return null;
  return parseSeed(readFileSync(file, 'utf8'), path.basename(file));
}
