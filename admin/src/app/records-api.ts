// Payers and patients from /api/admin/* (admin only). Patient records are PHI: keep them in memory,
// never in localStorage, never in console output.
import { api } from './shell';

export interface Payer {
  id: string;
  name: string;
  payerId: string;
  filingIndicator: string;
  phone: string | null;
  active: boolean;
}

export type Relationship = '18' | '01' | '19' | '53' | 'G8';
export type PatientSex = 'female' | 'male' | 'other' | 'unknown';

export interface Coverage {
  payerId: string;
  relationship: Relationship;
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
  sex: PatientSex;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  active: boolean;
  coverage: Coverage | null;
}

export { FILING_INDICATORS, RELATIONSHIPS } from './records-labels';

export const patientName = (p: Pick<Patient, 'firstName' | 'lastName'>) =>
  `${p.lastName}, ${p.firstName}`;

/** null = no database in this environment. */
async function fetchList<T>(path: string, key: string): Promise<T[] | null> {
  try {
    return (await api<Record<string, T[]>>(path))[key] ?? [];
  } catch (err) {
    if ((err as Error).message === 'db_disabled') return null;
    throw err;
  }
}

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
}

export const fetchLocations = () => fetchList<Location>('/api/admin/locations', 'locations');
export const fetchPayers = () => fetchList<Payer>('/api/admin/payers', 'payers');
export const fetchPatients = () => fetchList<Patient>('/api/admin/patients', 'patients');

/** Show API field errors on a form; returns true if there were field errors. */
export function showFieldErrors(
  form: HTMLFormElement,
  err: unknown,
  errEl: HTMLElement,
  codes: Record<string, string>,
): void {
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const body = (err as { body?: { error?: string; fields?: Record<string, string> } }).body;
  if (body?.fields) {
    for (const name of Object.keys(body.fields)) {
      form.querySelector(`[name="${name}"]`)?.setAttribute('aria-invalid', 'true');
    }
    errEl.textContent = Object.values(body.fields).join(' · ');
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  } else {
    errEl.textContent = codes[body?.error ?? ''] ?? "Couldn't save. Try again.";
  }
  errEl.hidden = false;
}

export function cell(text: string, className?: string) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

export function statusCell(active: boolean) {
  const td = document.createElement('td');
  const s = document.createElement('span');
  s.className = `status ${active ? 'is-active' : 'is-off'}`;
  s.textContent = active ? 'Active' : 'Inactive';
  td.append(s);
  return td;
}

export function editCell(label: string, onClick: () => void) {
  const btn = (
    document.getElementById('tpl-edit') as HTMLTemplateElement
  ).content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('click', onClick);
  const td = document.createElement('td');
  td.className = 'row-actions';
  td.append(btn);
  return td;
}

export function messageRow(body: HTMLElement, text: string, cols: number) {
  const tr = document.createElement('tr');
  const td = cell(text, 'empty-row');
  td.colSpan = cols;
  tr.append(td);
  body.replaceChildren(tr);
}
