// Providers page: list, add, edit, delete practice/clinician records.
import { fetchProviders, providerName, type Provider } from './providers-api';
import { $, api, handleAuthFailure, setText, wireDialog } from './shell';

const FIELDS = [
  'orgName',
  'firstName',
  'lastName',
  'credential',
  'role',
  'npi',
  'taxonomy',
  'taxId',
  'phone',
  'address1',
  'address2',
  'city',
  'state',
  'zip',
] as const;

const ERRORS: Record<string, string> = {
  duplicate_npi: 'A provider with this NPI already exists.',
  db_disabled: "No database is configured here, so this can't be saved.",
};

function cell(text: string, className?: string) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

const fmtTaxId = (t: string | null) => {
  const d = (t ?? '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : '—';
};

export function initProviders() {
  const body = $('providers-body');
  const dialog = $<HTMLDialogElement>('provider-dialog');
  const form = $<HTMLFormElement>('provider-form');
  const err = $('provider-error');
  let editing: Provider | null = null;
  let busy = false;
  wireDialog(dialog, () => busy);

  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  const kind = () => (form.elements.namedItem('kind') as RadioNodeList).value as Provider['kind'];
  const syncKind = () => {
    const k = kind();
    form.querySelectorAll<HTMLElement>('[data-kind]').forEach((el) => {
      el.hidden = el.dataset.kind !== k;
    });
  };
  form.addEventListener('change', syncKind);

  const message = (text: string) => {
    const tr = document.createElement('tr');
    const td = cell(text, 'empty-row');
    td.colSpan = 7;
    tr.append(td);
    body.replaceChildren(tr);
  };

  async function load() {
    try {
      const list = await fetchProviders();
      $('db-note').hidden = list !== null;
      $<HTMLButtonElement>('new-provider').disabled = list === null;
      if (list === null) return message('Not available in this environment.');
      if (list.length === 0)
        return message('No providers yet. Add the practice first, then each dentist.');
      body.replaceChildren(...list.map(row));
    } catch (e) {
      if (!handleAuthFailure(e)) message("Couldn't load providers. Refresh to try again.");
    }
  }

  function row(p: Provider) {
    const tr = document.createElement('tr');
    const status = document.createElement('span');
    status.className = `status ${p.active ? 'is-active' : 'is-off'}`;
    status.textContent = p.active ? 'Active' : 'Inactive';
    const statusTd = document.createElement('td');
    statusTd.append(status);
    const edit = $<HTMLTemplateElement>('tpl-edit').content.firstElementChild!.cloneNode(
      true,
    ) as HTMLButtonElement;
    edit.setAttribute('aria-label', `Edit ${providerName(p)}`);
    edit.addEventListener('click', () => open(p));
    const actions = document.createElement('td');
    actions.className = 'row-actions';
    actions.append(edit);
    const type =
      p.kind === 'organization'
        ? 'Practice'
        : p.role
          ? p.role[0]!.toUpperCase() + p.role.slice(1)
          : '';
    tr.append(
      cell(providerName(p)),
      cell(type),
      cell(p.npi),
      cell(p.taxonomy ?? '—'),
      cell(fmtTaxId(p.taxId)),
      statusTd,
      actions,
    );
    return tr;
  }

  function open(p: Provider | null) {
    editing = p;
    form.reset();
    setText(err, '');
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    $('provider-title').textContent = p ? 'Edit provider' : 'Add provider';
    $('provider-delete').hidden = !p;
    if (p) {
      (form.querySelector(`input[name="kind"][value="${p.kind}"]`) as HTMLInputElement).checked =
        true;
      for (const f of FIELDS) field(f).value = (p[f] as string | null) ?? '';
      if (!p.role) field('role').value = 'dentist';
      (field('active') as HTMLInputElement).checked = p.active;
    }
    syncKind();
    dialog.showModal();
  }

  function payload() {
    const out: Record<string, unknown> = {
      kind: kind(),
      active: (field('active') as HTMLInputElement).checked,
    };
    for (const f of FIELDS) {
      const el = field(f);
      if (el.closest<HTMLElement>('[data-kind]')?.hidden) continue;
      out[f] = el.value.trim();
    }
    return out;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    $<HTMLButtonElement>('provider-save').disabled = true;
    setText(err, '');
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    try {
      await api(editing ? `/api/admin/providers/${editing.id}` : '/api/admin/providers', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload()),
      });
      dialog.close();
      void load();
    } catch (e2) {
      if (handleAuthFailure(e2)) return;
      const b = (e2 as { body?: { error?: string; fields?: Record<string, string> } }).body;
      if (b?.fields) {
        for (const name of Object.keys(b.fields)) field(name)?.setAttribute('aria-invalid', 'true');
        setText(err, Object.values(b.fields).join(' · '));
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      } else setText(err, ERRORS[b?.error ?? ''] ?? "Couldn't save. Try again.");
    } finally {
      busy = false;
      $<HTMLButtonElement>('provider-save').disabled = false;
    }
  });

  $('provider-delete').addEventListener('click', async () => {
    if (!editing || busy) return;
    if (
      !confirm(
        `Delete ${providerName(editing)}? To keep the record but hide it from claims, mark it inactive instead.`,
      )
    )
      return;
    busy = true;
    try {
      await api(`/api/admin/providers/${editing.id}`, { method: 'DELETE' });
      dialog.close();
      void load();
    } catch (e) {
      if (!handleAuthFailure(e)) setText(err, "Couldn't delete. Try again.");
    } finally {
      busy = false;
    }
  });

  $('new-provider').addEventListener('click', () => open(null));
  void load();
}
