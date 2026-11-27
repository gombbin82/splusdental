// Patients page: list/search, add, edit, delete patients and their primary coverage.
// PHI stays in memory only (no localStorage, no console).
import {
  RELATIONSHIPS,
  cell,
  editCell,
  fetchPatients,
  fetchPayers,
  messageRow,
  patientName,
  showFieldErrors,
  type Patient,
  type Payer,
} from './records-api';
import { $, api, handleAuthFailure, wireDialog } from './shell';

const CODES: Record<string, string> = {
  in_use: 'This person is the subscriber on someone else’s insurance. Change that first.',
  duplicate_chart: 'Another patient already has this chart number.',
  invalid_reference: 'The insurance company or subscriber no longer exists. Refresh and try again.',
  self_subscriber: 'For a dependent, choose someone else as the subscriber.',
  db_disabled: "No database is configured here, so this can't be saved.",
};

const PERSON = [
  'firstName',
  'middleName',
  'lastName',
  'chartNumber',
  'birthDate',
  'sex',
  'phone',
  'address1',
  'address2',
  'city',
  'state',
  'zip',
] as const;

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

export function initPatients() {
  const body = $('patients-body');
  const dialog = $<HTMLDialogElement>('patient-dialog');
  const form = $<HTMLFormElement>('patient-form');
  const err = $('patient-error');
  const search = $<HTMLInputElement>('search');
  let patients: Patient[] = [];
  let payers: Payer[] = [];
  let editing: Patient | null = null;
  let busy = false;
  wireDialog(dialog, () => busy);
  const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement;

  const syncCoverage = () => {
    const has = f('coverage.payerId').value !== '';
    form.querySelectorAll<HTMLElement>('[data-cov]').forEach((el) => (el.hidden = !has));
    const dependent = f('coverage.relationship').value !== '18';
    form.querySelectorAll<HTMLElement>('[data-dependent]').forEach((el) => {
      el.hidden = !has || !dependent;
    });
  };
  form.addEventListener('change', syncCoverage);

  function render() {
    const q = search.value.trim().toLowerCase();
    const byId = new Map(patients.map((p) => [p.id, p]));
    const payerById = new Map(payers.map((p) => [p.id, p]));
    const shown = patients.filter(
      (p) =>
        !q ||
        `${p.firstName} ${p.lastName} ${p.lastName}, ${p.firstName}`.toLowerCase().includes(q) ||
        (p.chartNumber ?? '').toLowerCase().includes(q),
    );
    $('count').textContent = patients.length ? `${shown.length} of ${patients.length}` : '';
    if (patients.length === 0) return messageRow(body, 'No patients yet.', 6);
    if (shown.length === 0) return messageRow(body, 'No matches.', 6);
    body.replaceChildren(
      ...shown.map((p) => {
        const c = p.coverage;
        const payer = c ? payerById.get(c.payerId) : undefined;
        const sub = c && c.relationship !== '18' ? byId.get(c.subscriberId) : undefined;
        const tr = document.createElement('tr');
        if (!p.active) tr.className = 'is-inactive';
        tr.append(
          cell(patientName(p)),
          cell(p.chartNumber ?? '—'),
          cell(fmtDate(p.birthDate)),
          cell(c ? `${payer?.name ?? '?'} · ${c.memberId}` : '—'),
          cell(!c ? '—' : sub ? `${patientName(sub)} (${RELATIONSHIPS[c.relationship]})` : 'Self'),
          editCell(`Edit ${patientName(p)}`, () => open(p)),
        );
        return tr;
      }),
    );
  }

  async function load() {
    try {
      const [pts, pys] = await Promise.all([fetchPatients(), fetchPayers()]);
      $('db-note').hidden = pts !== null;
      $<HTMLButtonElement>('new-patient').disabled = pts === null;
      if (pts === null) return messageRow(body, 'Not available in this environment.', 6);
      patients = pts;
      payers = pys ?? [];
      render();
    } catch (e) {
      if (!handleAuthFailure(e)) messageRow(body, "Couldn't load. Refresh to try again.", 6);
    }
  }

  function fillSelect(sel: HTMLSelectElement, first: string, items: [string, string][]) {
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = first;
    sel.replaceChildren(
      o0,
      ...items.map(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        return o;
      }),
    );
  }

  function open(p: Patient | null) {
    editing = p;
    form.reset();
    err.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    $('patient-title').textContent = p ? 'Edit patient' : 'Add patient';
    $('patient-delete').hidden = !p;

    const c = p?.coverage;
    // Inactive payers stay listed only if this patient already uses one.
    fillSelect(
      f('coverage.payerId') as HTMLSelectElement,
      'None',
      payers
        .filter((y) => y.active || y.id === c?.payerId)
        .map((y) => [y.id, `${y.name} (${y.payerId})`]),
    );
    fillSelect(
      f('coverage.subscriberId') as HTMLSelectElement,
      'Choose…',
      patients
        .filter((x) => x.id !== p?.id)
        .map((x) => [x.id, `${patientName(x)} · ${fmtDate(x.birthDate)}`]),
    );

    if (p) {
      for (const k of PERSON) f(k).value = (p[k] as string | null) ?? '';
      (f('active') as HTMLInputElement).checked = p.active;
      if (c) {
        f('coverage.payerId').value = c.payerId;
        f('coverage.relationship').value = c.relationship;
        f('coverage.subscriberId').value = c.relationship === '18' ? '' : c.subscriberId;
        f('coverage.memberId').value = c.memberId;
        f('coverage.groupNumber').value = c.groupNumber ?? '';
        f('coverage.groupName').value = c.groupName ?? '';
      }
    }
    syncCoverage();
    dialog.showModal();
  }

  function payload() {
    const out: Record<string, unknown> = { active: (f('active') as HTMLInputElement).checked };
    for (const k of PERSON) out[k] = f(k).value.trim() || null;
    const payerId = f('coverage.payerId').value;
    const relationship = f('coverage.relationship').value;
    out.coverage = payerId
      ? {
          payerId,
          relationship,
          subscriberId: relationship === '18' ? null : f('coverage.subscriberId').value || null,
          memberId: f('coverage.memberId').value.trim(),
          groupNumber: f('coverage.groupNumber').value.trim() || null,
          groupName: f('coverage.groupName').value.trim() || null,
        }
      : null;
    return out;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    err.hidden = true;
    try {
      await api(editing ? `/api/admin/patients/${editing.id}` : '/api/admin/patients', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload()),
      });
      dialog.close();
      void load();
    } catch (e2) {
      if (!handleAuthFailure(e2)) showFieldErrors(form, e2, err, CODES);
    } finally {
      busy = false;
    }
  });

  $('patient-delete').addEventListener('click', async () => {
    if (!editing || busy || !confirm(`Delete ${patientName(editing)} and their insurance?`)) return;
    busy = true;
    try {
      await api(`/api/admin/patients/${editing.id}`, { method: 'DELETE' });
      dialog.close();
      void load();
    } catch (e) {
      if (!handleAuthFailure(e)) showFieldErrors(form, e, err, CODES);
    } finally {
      busy = false;
    }
  });

  search.addEventListener('input', render);
  $('new-patient').addEventListener('click', () => open(null));
  void load();
}
