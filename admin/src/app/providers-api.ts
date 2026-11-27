// Provider records from /api/admin/providers (admin only). Shared by the Providers and claims pages.
import { api } from './shell';

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

export function providerName(p: Provider): string {
  if (p.kind === 'organization') return p.orgName ?? '';
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  return p.credential ? `${name}, ${p.credential}` : name;
}

/** null = no database in this environment. */
export async function fetchProviders(): Promise<Provider[] | null> {
  try {
    return (await api<{ providers: Provider[] }>('/api/admin/providers')).providers;
  } catch (err) {
    if ((err as Error).message === 'db_disabled') return null;
    throw err;
  }
}
