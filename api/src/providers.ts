// Providers: the practice (billing provider, group NPI) and its dentists/hygienists (rendering
// providers). Admin-only CRUD; used to prefill the insurance claim page.

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { isUniqueViolation } from './db/errors.js';
import type { Db } from './db/index.js';
import { providers, type ProviderRow } from './db/schema.js';

/** NPI check digit: Luhn over "80840" + the first 9 digits. */
export function isValidNpi(npi: string): boolean {
  if (!/^[12]\d{9}$/.test(npi)) return false;
  const s = '80840' + npi.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

const digits = (v: string) => v.replace(/\D/g, '');
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const providerInput = z
  .object({
    kind: z.enum(['organization', 'person']),
    orgName: opt(60),
    firstName: opt(35),
    lastName: opt(60),
    credential: opt(10),
    role: z.enum(['dentist', 'hygienist', 'assistant']).nullish(),
    npi: z.string().transform(digits),
    taxId: z
      .string()
      .optional()
      .transform((v) => (v ? digits(v) : null)),
    taxonomy: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null)),
    address1: opt(55),
    address2: opt(55),
    city: opt(30),
    state: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null)),
    zip: z
      .string()
      .optional()
      .transform((v) => (v ? digits(v) : null)),
    phone: z
      .string()
      .optional()
      .transform((v) => (v ? digits(v) : null)),
    active: z.boolean().optional().default(true),
  })
  .superRefine((p, ctx) => {
    const bad = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (!isValidNpi(p.npi)) bad('npi', 'Not a valid NPI');
    if (p.taxId && p.taxId.length !== 9) bad('taxId', 'Tax ID must be 9 digits');
    if (p.taxonomy && !/^[0-9A-Z]{9}X$/.test(p.taxonomy))
      bad('taxonomy', 'Taxonomy is 10 characters ending in X');
    if (p.state && !/^[A-Z]{2}$/.test(p.state)) bad('state', 'State must be 2 letters');
    if (p.zip && p.zip.length !== 5 && p.zip.length !== 9) bad('zip', 'ZIP must be 5 or 9 digits');
    if (p.phone && p.phone.length !== 10) bad('phone', 'Phone must be 10 digits');
    if (p.kind === 'organization') {
      if (!p.orgName) bad('orgName', 'Name is required');
      if (!p.taxId) bad('taxId', 'Tax ID is required for the practice');
      if (!p.address1) bad('address1', 'Street address is required');
      if (!p.city) bad('city', 'City is required');
      if (!p.state) bad('state', 'State is required');
      if (!p.zip || p.zip.length !== 9) bad('zip', 'ZIP+4 (9 digits) is required for billing');
    } else {
      if (!p.firstName) bad('firstName', 'First name is required');
      if (!p.lastName) bad('lastName', 'Last name is required');
    }
  });

export type ProviderInput = z.output<typeof providerInput>;

export interface Provider {
  id: string;
  kind: 'organization' | 'person';
  orgName: string | null;
  firstName: string | null;
  lastName: string | null;
  credential: string | null;
  role: 'dentist' | 'hygienist' | 'assistant' | null;
  npi: string;
  taxId: string | null;
  taxonomy: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

function toProvider(r: ProviderRow): Provider {
  return {
    id: r.id,
    kind: r.kind,
    orgName: r.orgName,
    firstName: r.firstName,
    lastName: r.lastName,
    credential: r.credential,
    role: r.role,
    npi: r.npi,
    taxId: r.taxId,
    taxonomy: r.taxonomy,
    address1: r.address1,
    address2: r.address2,
    city: r.city,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    active: r.active,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  };
}

function values(p: ProviderInput) {
  const person = p.kind === 'person';
  return {
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
  };
}

export class DuplicateNpiError extends Error {}

export async function listProviders(db: Db): Promise<Provider[]> {
  const rows = await db
    .select()
    .from(providers)
    .orderBy(asc(providers.kind), asc(providers.lastName), asc(providers.orgName));
  return rows.map(toProvider);
}

export async function createProvider(db: Db, p: ProviderInput, by: string): Promise<Provider> {
  try {
    const [row] = await db
      .insert(providers)
      .values({ ...values(p), createdBy: by, updatedBy: by })
      .returning();
    return toProvider(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateNpiError();
    throw err;
  }
}

export async function updateProvider(
  db: Db,
  id: string,
  p: ProviderInput,
  by: string,
): Promise<Provider | null> {
  try {
    const [row] = await db
      .update(providers)
      .set({ ...values(p), updatedBy: by, updatedAt: new Date() })
      .where(eq(providers.id, id))
      .returning();
    return row ? toProvider(row) : null;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateNpiError();
    throw err;
  }
}

export async function deleteProvider(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(providers)
    .where(eq(providers.id, id))
    .returning({ id: providers.id });
  return rows.length > 0;
}
