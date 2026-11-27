// Database schema (Drizzle, Postgres). Adapted from gombbin82/kiwidental `src/db/schema.ts` so the
// two can merge later. Providers are practice/clinician records (public
// NPI registry data plus the practice EIN).
//
// After changing this file: `pnpm --filter api db:generate`, then commit the new SQL in api/drizzle.

import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** organization: the practice (group NPI, billing provider). person: a dentist or hygienist. */
export const providerKind = pgEnum('provider_kind', ['organization', 'person']);
export const providerRole = pgEnum('provider_role', ['dentist', 'hygienist', 'assistant']);

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: providerKind('kind').notNull(),
    /** Organization name as on the NPI record (kind = organization). */
    orgName: text('org_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    credential: text('credential'), // DDS, DMD, RDH
    role: providerRole('role'), // kind = person
    npi: text('npi').notNull(),
    /** EIN, 9 digits. Never an SSN. */
    taxId: text('tax_id'),
    taxonomy: text('taxonomy'), // e.g. 1223G0001X
    address1: text('address1'),
    address2: text('address2'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    phone: text('phone'),
    active: boolean('active').notNull().default(true),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('providers_npi_uq').on(t.npi)],
);

export type ProviderRow = typeof providers.$inferSelect;

// ---------- insurance and patients ----------
// Patient and coverage rows are PHI. Never log their values, only ids. Admin-only routes.

/** Same values as kiwidental's `sex` enum. Mapped to X12 F/M/U when building claims. */
export const sex = pgEnum('sex', ['female', 'male', 'other', 'unknown']);

/** Insurance companies, as listed on the clearinghouse payer list. */
export const payers = pgTable('payers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Clearinghouse (DentalXChange) payer ID. */
  payerId: text('payer_id').notNull(),
  /** Default SBR09 claim filing indicator: CI commercial, 12 PPO, MC Medicaid… */
  filingIndicator: text('filing_indicator').notNull().default('CI'),
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Patients, and people who are only subscribers (a parent whose plan covers a child). Kiwidental
 * keeps addresses on `families`; here they sit on the person until the two merge.
 */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chartNumber: text('chart_number'),
    firstName: text('first_name').notNull(),
    middleName: text('middle_name'),
    lastName: text('last_name').notNull(),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    sex: sex('sex').notNull().default('unknown'),
    address1: text('address1'),
    address2: text('address2'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    phone: text('phone'),
    active: boolean('active').notNull().default(true),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('patients_chart_uq').on(t.chartNumber),
    index('patients_name_idx').on(t.lastName, t.firstName),
  ],
);

/** Relationship of the patient to the subscriber, as X12 codes: 18 self, 01 spouse, 19 child, 53 life partner, G8 other. */
export const relationship = pgEnum('relationship', ['18', '01', '19', '53', 'G8']);
export const coveragePriority = pgEnum('coverage_priority', ['primary', 'secondary']);

/** A patient's dental plan. The subscriber is a row in `patients` (the patient themself when self). */
export const coverages = pgTable(
  'coverages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    payerId: uuid('payer_id')
      .notNull()
      .references(() => payers.id, { onDelete: 'restrict' }),
    // NO ACTION (checked at end of statement), not RESTRICT: deleting a self-subscribed patient
    // cascades their own coverage first. Deleting someone who subscribes for others still fails.
    subscriberId: uuid('subscriber_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'no action' }),
    relationship: relationship('relationship').notNull(),
    priority: coveragePriority('priority').notNull().default('primary'),
    memberId: text('member_id').notNull(),
    groupNumber: text('group_number'),
    groupName: text('group_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('coverages_patient_priority_uq').on(t.patientId, t.priority)],
);

export type PayerRow = typeof payers.$inferSelect;
export type PatientRow = typeof patients.$inferSelect;
export type CoverageRow = typeof coverages.$inferSelect;

/** Treatment locations (offices). Same shape as kiwidental's `locations`, with split address fields. */
export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address1: text('address1').notNull(),
  address2: text('address2'),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zip: text('zip').notNull(),
  phone: text('phone'),
  active: boolean('active').notNull().default(true),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type LocationRow = typeof locations.$inferSelect;
