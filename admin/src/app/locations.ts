// Locations card on the Providers page: list, add, edit, delete offices.
import {
  cell,
  editCell,
  fetchLocations,
  messageRow,
  showFieldErrors,
  statusCell,
  type Location,
} from './records-api';
import { $, api, handleAuthFailure, wireDialog } from './shell';

const FIELDS = ['name', 'address1', 'address2', 'city', 'state', 'zip', 'phone'] as const;
const CODES: Record<string, string> = {
  db_disabled: "No database is configured here, so this can't be saved.",
};

const fmtZip = (z: string) => (z.length === 9 ? `${z.slice(0, 5)}-${z.slice(5)}` : z);
const fmtPhone = (p: string | null) =>
  p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : '—';

export function initLocations() {
  const body = $('locations-body');
  const dialog = $<HTMLDialogElement>('location-dialog');
  const form = $<HTMLFormElement>('location-form');
  const err = $('location-error');
  let editing: Location | null = null;
  let busy = false;
  wireDialog(dialog, () => busy);
  const f = (n: string) => form.elements.namedItem(n) as HTMLInputElement;

  async function load() {
    try {
      const list = await fetchLocations();
      $<HTMLButtonElement>('new-location').disabled = list === null;
      if (list === null) return messageRow(body, 'Not available in this environment.', 5);
      if (list.length === 0) return messageRow(body, 'No locations yet.', 5);
      body.replaceChildren(
        ...list.map((l) => {
          const tr = document.createElement('tr');
          const addr = [l.address1, l.address2, `${l.city}, ${l.state} ${fmtZip(l.zip)}`]
            .filter(Boolean)
            .join(', ');
          tr.append(
            cell(l.name),
            cell(addr),
            cell(fmtPhone(l.phone)),
            statusCell(l.active),
            editCell(`Edit ${l.name}`, () => open(l)),
          );
          return tr;
        }),
      );
    } catch (e) {
      if (!handleAuthFailure(e)) messageRow(body, "Couldn't load. Refresh to try again.", 5);
    }
  }

  function open(l: Location | null) {
    editing = l;
    form.reset();
    err.hidden = true;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    $('location-title').textContent = l ? 'Edit location' : 'Add location';
    $('location-delete').hidden = !l;
    if (l) {
      for (const k of FIELDS) f(k).value = (k === 'zip' ? fmtZip(l.zip) : l[k]) ?? '';
      f('active').checked = l.active;
    }
    dialog.showModal();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    err.hidden = true;
    const payload: Record<string, unknown> = { active: f('active').checked };
    for (const k of FIELDS) payload[k] = f(k).value.trim() || null;
    try {
      await api(editing ? `/api/admin/locations/${editing.id}` : '/api/admin/locations', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      dialog.close();
      void load();
    } catch (e2) {
      if (!handleAuthFailure(e2)) showFieldErrors(form, e2, err, CODES);
    } finally {
      busy = false;
    }
  });

  $('location-delete').addEventListener('click', async () => {
    if (!editing || busy || !confirm(`Delete ${editing.name}?`)) return;
    busy = true;
    try {
      await api(`/api/admin/locations/${editing.id}`, { method: 'DELETE' });
      dialog.close();
      void load();
    } catch (e) {
      if (!handleAuthFailure(e)) showFieldErrors(form, e, err, CODES);
    } finally {
      busy = false;
    }
  });

  $('new-location').addEventListener('click', () => open(null));
  void load();
}
