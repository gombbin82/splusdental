// Insurance page: list, add, edit, delete payers.
import {
  FILING_INDICATORS,
  cell,
  editCell,
  fetchPayers,
  messageRow,
  showFieldErrors,
  statusCell,
  type Payer,
} from './records-api';
import { $, api, handleAuthFailure, wireDialog } from './shell';

const CODES: Record<string, string> = {
  in_use: "A patient's insurance still uses this payer. Mark it inactive instead.",
  db_disabled: "No database is configured here, so this can't be saved.",
};

const fmtPhone = (p: string | null) =>
  p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : '—';

export function initInsurance() {
  const body = $('payers-body');
  const dialog = $<HTMLDialogElement>('payer-dialog');
  const form = $<HTMLFormElement>('payer-form');
  const err = $('payer-error');
  let editing: Payer | null = null;
  let busy = false;
  wireDialog(dialog, () => busy);
  const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement;

  async function load() {
    try {
      const list = await fetchPayers();
      $('db-note').hidden = list !== null;
      $<HTMLButtonElement>('new-payer').disabled = list === null;
      if (list === null) return messageRow(body, 'Not available in this environment.', 6);
      if (list.length === 0) return messageRow(body, 'No insurance companies yet.', 6);
      body.replaceChildren(
        ...list.map((p) => {
          const tr = document.createElement('tr');
          tr.append(
            cell(p.name),
            cell(p.payerId),
            cell(FILING_INDICATORS[p.filingIndicator] ?? p.filingIndicator),
            cell(fmtPhone(p.phone)),
            statusCell(p.active),
            editCell(`Edit ${p.name}`, () => open(p)),
          );
          return tr;
        }),
      );
    } catch (e) {
      if (!handleAuthFailure(e)) messageRow(body, "Couldn't load. Refresh to try again.", 6);
    }
  }

  function open(p: Payer | null) {
    editing = p;
    form.reset();
    err.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    $('payer-title').textContent = p ? 'Edit insurance' : 'Add insurance';
    $('payer-delete').hidden = !p;
    if (p) {
      f('name').value = p.name;
      f('payerId').value = p.payerId;
      f('filingIndicator').value = p.filingIndicator;
      f('phone').value = p.phone ?? '';
      f('active').checked = p.active;
    }
    dialog.showModal();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    err.hidden = true;
    try {
      await api(editing ? `/api/admin/payers/${editing.id}` : '/api/admin/payers', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: f('name').value.trim(),
          payerId: f('payerId').value.trim(),
          filingIndicator: f('filingIndicator').value,
          phone: f('phone').value.trim(),
          active: f('active').checked,
        }),
      });
      dialog.close();
      void load();
    } catch (e2) {
      if (!handleAuthFailure(e2)) showFieldErrors(form, e2, err, CODES);
    } finally {
      busy = false;
    }
  });

  $('payer-delete').addEventListener('click', async () => {
    if (!editing || busy || !confirm(`Delete ${editing.name}?`)) return;
    busy = true;
    try {
      await api(`/api/admin/payers/${editing.id}`, { method: 'DELETE' });
      dialog.close();
      void load();
    } catch (e) {
      if (!handleAuthFailure(e)) showFieldErrors(form, e, err, CODES);
    } finally {
      busy = false;
    }
  });

  $('new-payer').addEventListener('click', () => open(null));
  void load();
}
