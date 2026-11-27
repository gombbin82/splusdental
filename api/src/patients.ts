// Patients (and subscribers who aren't patients) with their primary dental coverage.
//
// PHI: admin-only routes; never log names, dates, member IDs or any other values, only row ids.
// Validation messages here are generic ("Birth date is required") and never echo input.

import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { isForeignKeyViolation, isUniqueViolation } from './db/errors.js';
import type { Db } from './db/index.js';
import { coverages, patients, type CoverageRow, type PatientRow } from './db/schema.js';
import { InUseError } from './payers.js';

const UUID = z.string().uuid();
const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

function isPastDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v) && d.getTime() <= Date.now();
}

export const coverageInput = z
  .object({
    payerId: UUID,
    relationship: z.enum(['18', '01', '19', '53', 'G8']),
    /** Required unless relationship is 18 (self). */
    subscriberId: UUID.nullish(),
    memberId: z.string().trim().min(1, 'Member ID is required').max(80),
    groupNumber: opt(50),
    groupName: opt(60),
  })
  .superRefine((c, ctx) => {
    if (c.relationship !== '18' && !c.subscriberId) {
      ctx.addIssue({ code: 'custom', path: ['subscriberId'], message: 'Choose the subscriber' });
    }
  });

export const patientInput = z.object({
  chartNumber: opt(20),
  firstName: z.string().trim().min(1, 'First name is required').max(35),
  middleName: opt(25),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  birthDate: z.string().refine(isPastDate, 'Birth date is required (not in the future)'),
  sex: z.enum(['female', 'male', 'other', 'unknown']).default('unknown'),
  address1: opt(55),
  address2: opt(55),
  city: opt(30),
  state: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'State must be 2 letters'),
  zip: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || v.length === 5 || v.length === 9, 'ZIP must be 5 or 9 digits'),
  phone: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\D/g, '') : null))
    .refine((v) => v === null || v.length === 10, 'Phone must be 10 digits'),
  active: z.boolean().optional().default(true),
  /** Primary coverage; null removes it. */
  coverage: coverageInput.nullish(),
});

export type PatientInput = z.output<typeof patientInput>;

export interface Coverage {
  payerId: string;
  relationship: '18' | '01' | '19' | '53' | 'G8';
  subscriberId: string;
  memberId: string;
  groupNumber: string | null;
  groupName: string | null;
}

export interface Patient {
  id: string;
  chartNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  birthDate: string;
  sex: 'female' | 'male' | 'other' | 'unknown';
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  active: boolean;
  coverage: Coverage | null;
  updatedAt: string;
}

function toPatient(r: PatientRow, c: CoverageRow | null): Patient {
  return {
    id: r.id,
    chartNumber: r.chartNumber,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    birthDate: r.birthDate,
    sex: r.sex,
    address1: r.address1,
    address2: r.address2,
    city: r.city,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    active: r.active,
    coverage: c
      ? {
          payerId: c.payerId,
          relationship: c.relationship,
          subscriberId: c.subscriberId,
          memberId: c.memberId,
          groupNumber: c.groupNumber,
          groupName: c.groupName,
        }
      : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export class DuplicateChartError extends Error {}
/** The coverage points at a payer or subscriber that doesn't exist. */
export class BadReferenceError extends Error {}
/** A dependent's subscriber can't be the patient themself. */
export class SelfSubscriberError extends Error {}

const primary = and(eq(coverages.priority, 'primary'));

async function getOne(db: Db, id: string): Promise<Patient | null> {
  const [r] = await db
    .select()
    .from(patients)
    .leftJoin(coverages, and(eq(coverages.patientId, patients.id), primary))
    .where(eq(patients.id, id));
  return r ? toPatient(r.patients, r.coverages) : null;
}

export async function listPatients(db: Db): Promise<Patient[]> {
  const rows = await db
    .select()
    .from(patients)
    .leftJoin(coverages, and(eq(coverages.patientId, patients.id), primary))
    .orderBy(asc(patients.lastName), asc(patients.firstName))
    .limit(2000);
  return rows.map((r) => toPatient(r.patients, r.coverages));
}

function patientValues(p: PatientInput) {
  const rest: Partial<PatientInput> = { ...p };
  delete rest.coverage;
  return rest as Omit<PatientInput, 'coverage'>;
}

async function saveCoverage(tx: Db, patientId: string, c: PatientInput['coverage']) {
  if (c === undefined) return; // not sent: leave as is
  await tx
    .delete(coverages)
    .where(and(eq(coverages.patientId, patientId), eq(coverages.priority, 'primary')));
  if (c === null) return;
  const subscriberId = c.relationship === '18' ? patientId : c.subscriberId!;
  if (c.relationship !== '18' && subscriberId === patientId) throw new SelfSubscriberError();
  await tx.insert(coverages).values({
    patientId,
    payerId: c.payerId,
    subscriberId,
    relationship: c.relationship,
    priority: 'primary',
    memberId: c.memberId,
    groupNumber: c.groupNumber,
    groupName: c.groupName,
  });
}

function mapError(err: unknown): never {
  if (isUniqueViolation(err)) throw new DuplicateChartError();
  if (isForeignKeyViolation(err)) throw new BadReferenceError();
  throw err;
}

export async function createPatient(db: Db, p: PatientInput, by: string): Promise<Patient> {
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(patients)
        .values({ ...patientValues(p), createdBy: by, updatedBy: by })
        .returning({ id: patients.id });
      await saveCoverage(tx as unknown as Db, row!.id, p.coverage);
      return row!.id;
    });
    return (await getOne(db, id))!;
  } catch (err) {
    if (err instanceof SelfSubscriberError) throw err;
    mapError(err);
  }
}

export async function updatePatient(
  db: Db,
  id: string,
  p: PatientInput,
  by: string,
): Promise<Patient | null> {
  try {
    const found = await db.transaction(async (tx) => {
      const rows = await tx
        .update(patients)
        .set({ ...patientValues(p), updatedBy: by, updatedAt: new Date() })
        .where(eq(patients.id, id))
        .returning({ id: patients.id });
      if (rows.length === 0) return false;
      await saveCoverage(tx as unknown as Db, id, p.coverage);
      return true;
    });
    return found ? await getOne(db, id) : null;
  } catch (err) {
    if (err instanceof SelfSubscriberError) throw err;
    mapError(err);
  }
}

/** Throws InUseError if this person is the subscriber on someone else's coverage. */
export async function deletePatient(db: Db, id: string): Promise<boolean> {
  try {
    const rows = await db
      .delete(patients)
      .where(eq(patients.id, id))
      .returning({ id: patients.id });
    return rows.length > 0;
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new InUseError();
    throw err;
  }
}
