// Insurance companies (payers) and their clearinghouse payer IDs. Admin-only CRUD.

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { isForeignKeyViolation } from './db/errors.js';
import type { Db } from './db/index.js';
import { payers, type PayerRow } from './db/schema.js';

/** SBR09 claim filing indicator codes offered in the UI. */
export const FILING_INDICATORS = ['CI', '12', '17', 'HM', 'BL', 'MC', 'CH', 'FI'] as const;

export const payerInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  payerId: z
    .string()
    .trim()
    .min(1, 'Payer ID is required')
    .max(80)
    .transform((v) => v.toUpperCase()),
  filingIndicator: z.enum(FILING_INDICATORS).default('CI'),
  phone: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || v.length === 10, 'Phone must be 10 digits'),
  active: z.boolean().optional().default(true),
});

export type PayerInput = z.output<typeof payerInput>;

export interface Payer {
  id: string;
  name: string;
  payerId: string;
  filingIndicator: string;
  phone: string | null;
  active: boolean;
  updatedAt: string;
}

const toPayer = (r: PayerRow): Payer => ({
  id: r.id,
  name: r.name,
  payerId: r.payerId,
  filingIndicator: r.filingIndicator,
  phone: r.phone,
  active: r.active,
  updatedAt: r.updatedAt.toISOString(),
});

export class InUseError extends Error {}

export async function listPayers(db: Db): Promise<Payer[]> {
  return (await db.select().from(payers).orderBy(asc(payers.name))).map(toPayer);
}

export async function createPayer(db: Db, p: PayerInput, by: string): Promise<Payer> {
  const [row] = await db
    .insert(payers)
    .values({ ...p, createdBy: by, updatedBy: by })
    .returning();
  return toPayer(row!);
}

export async function updatePayer(
  db: Db,
  id: string,
  p: PayerInput,
  by: string,
): Promise<Payer | null> {
  const [row] = await db
    .update(payers)
    .set({ ...p, updatedBy: by, updatedAt: new Date() })
    .where(eq(payers.id, id))
    .returning();
  return row ? toPayer(row) : null;
}

/** Throws InUseError if a patient's coverage still points at this payer. */
export async function deletePayer(db: Db, id: string): Promise<boolean> {
  try {
    const rows = await db.delete(payers).where(eq(payers.id, id)).returning({ id: payers.id });
    return rows.length > 0;
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new InUseError();
    throw err;
  }
}
