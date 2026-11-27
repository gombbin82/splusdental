// Treatment locations (offices). Admin-only CRUD.

import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db/index.js';
import { locations, type LocationRow } from './db/schema.js';

const digits = (v: string) => v.replace(/\D/g, '');

export const locationInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  address1: z.string().trim().min(1, 'Street address is required').max(55),
  address2: z
    .string()
    .trim()
    .max(55)
    .nullish()
    .transform((v) => v || null),
  city: z.string().trim().min(1, 'City is required').max(30),
  state: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z]{2}$/.test(v), 'State must be 2 letters'),
  zip: z
    .string()
    .transform(digits)
    .refine((v) => v.length === 5 || v.length === 9, 'ZIP must be 5 or 9 digits'),
  phone: z
    .string()
    .nullish()
    .transform((v) => (v ? digits(v) : null))
    .refine((v) => v === null || v.length === 10, 'Phone must be 10 digits'),
  active: z.boolean().optional().default(true),
});

export type LocationInput = z.output<typeof locationInput>;

export interface Location {
  id: string;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  active: boolean;
  updatedAt: string;
}

const toLocation = (r: LocationRow): Location => ({
  id: r.id,
  name: r.name,
  address1: r.address1,
  address2: r.address2,
  city: r.city,
  state: r.state,
  zip: r.zip,
  phone: r.phone,
  active: r.active,
  updatedAt: r.updatedAt.toISOString(),
});

export async function listLocations(db: Db): Promise<Location[]> {
  return (await db.select().from(locations).orderBy(asc(locations.name))).map(toLocation);
}

export async function createLocation(db: Db, l: LocationInput, by: string): Promise<Location> {
  const [row] = await db
    .insert(locations)
    .values({ ...l, createdBy: by, updatedBy: by })
    .returning();
  return toLocation(row!);
}

export async function updateLocation(
  db: Db,
  id: string,
  l: LocationInput,
  by: string,
): Promise<Location | null> {
  const [row] = await db
    .update(locations)
    .set({ ...l, updatedBy: by, updatedAt: new Date() })
    .where(eq(locations.id, id))
    .returning();
  return row ? toLocation(row) : null;
}

export async function deleteLocation(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .delete(locations)
    .where(eq(locations.id, id))
    .returning({ id: locations.id });
  return rows.length > 0;
}
