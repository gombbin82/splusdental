// Payment links: recent-links table (full and compact) and the create dialog.
import { inRange, toCents } from './money';
import { $, api, handleAuthFailure, setText } from './shell';

export interface LinkRow {
  id: string;
  url: string;
  active: boolean;
  amountDisplay: string;
  description: string | null;
  metadata: Record<string, string>;
  created: number | null;
}

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export async function copyText(text: string, btn: HTMLElement) {
  const label = btn.querySelector<HTMLElement>('[data-label]') ?? btn;
  const original = label.textContent;
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied';
  } catch {
    label.textContent = 'Copy failed';
  }
  btn.setAttribute('title', label.textContent ?? '');
  setTimeout(() => {
    label.textContent = original;
    btn.setAttribute('title', original ?? '');
  }, 1800);
}

function cell(text: string, className?: string) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function statusChip(active: boolean) {
  const s = document.createElement('span');
  s.className = `status ${active ? 'is-active' : 'is-off'}`;
  s.textContent = active ? 'Active' : 'Inactive';
  return s;
}

/** Clone an icon button from a <template> in the shell. */
function iconButton(tpl: 'tpl-copy' | 'tpl-deactivate') {
  const t = $<HTMLTemplateElement>(tpl);
  return t.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
}

export class LinksTable {
  constructor(
    private readonly body: HTMLElement,
    private readonly opts: { limit: number; compact?: boolean; columns: number },
  ) {}

  private message(text: string) {
    const tr = document.createElement('tr');
    const td = cell(text, 'empty-row');
    td.colSpan = this.opts.columns;
    tr.append(td);
    this.body.replaceChildren(tr);
  }

  private row(l: LinkRow) {
    const tr = document.createElement('tr');
    const ref = [l.metadata.patient_ref, l.metadata.invoice].filter(Boolean).join(' / ');
    const by = (l.metadata.created_by ?? '').split('@')[0] ?? '';

    const desc = cell(l.description ?? '', 'desc');
    const status = document.createElement('td');
    status.append(statusChip(l.active));

    const actions = document.createElement('td');
    actions.className = 'actions';
    const copyBtn = iconButton('tpl-copy');
    copyBtn.addEventListener('click', () => void copyText(l.url, copyBtn));
    actions.append(copyBtn);
    if (l.active && !this.opts.compact) {
      const off = iconButton('tpl-deactivate');
      off.addEventListener('click', () => void this.deactivate(l, off));
      actions.append(off);
    }

    const created = cell(l.created ? dateFmt.format(new Date(l.created * 1000)) : '—', 'nowrap');
    const amount = cell(l.amountDisplay, 'num');
    if (this.opts.compact) {
      tr.append(created, desc, amount, status, actions);
    } else {
      tr.append(created, desc, amount, cell(ref || '—'), cell(by || '—'), status, actions);
    }
    return tr;
  }

  async load() {
    this.body.setAttribute('aria-busy', 'true');
    try {
      const { links } = await api<{ links: LinkRow[] }>(
        `/api/payment-links?limit=${this.opts.limit}`,
      );
      if (!links.length) {
        this.message('No payment links yet. Create one to send to a patient.');
      } else {
        this.body.replaceChildren(...links.map((l) => this.row(l)));
      }
    } catch (err) {
      if (!handleAuthFailure(err)) this.message("Couldn't load payment links. Try refreshing.");
    } finally {
      this.body.removeAttribute('aria-busy');
    }
  }

  private async deactivate(l: LinkRow, btn: HTMLButtonElement) {
    const ok = confirm(
      `Deactivate this ${l.amountDisplay} link? Patients won't be able to pay with it anymore.`,
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      await api(`/api/payment-links/${encodeURIComponent(l.id)}/deactivate`, { method: 'POST' });
      await this.load();
    } catch (err) {
      if (!handleAuthFailure(err)) {
        btn.disabled = false;
        alert("Couldn't deactivate the link. Try again.");
      }
    }
  }
}

// ---------- create dialog ----------

const FIELD_LABELS: Record<string, string> = {
  amountCents: 'amount',
  presetCents: 'suggested amount',
  minimumCents: 'minimum',
  maximumCents: 'maximum',
  description: 'description',
  patientRef: 'patient reference',
  invoice: 'invoice number',
};

export function initCreateDialog(onCreated: () => void) {
  const dialog = $<HTMLDialogElement>('create-dialog');
  const form = $<HTMLFormElement>('link-form');
  const formError = $('form-error');
  let pendingIdempotencyKey: string | null = null;

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const amountType = () =>
    (form.elements.namedItem('amountType') as RadioNodeList).value as 'fixed' | 'customer';

  const syncAmountFields = () => {
    const type = amountType();
    form.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => {
      el.hidden = el.dataset.show !== type;
    });
  };

  const readMoney = (name: string, required: boolean, errors: string[], label: string) => {
    const el = input(name);
    const c = toCents(el.value);
    const bad = (c === null && required) || (c !== null && !inRange(c));
    el.setAttribute('aria-invalid', String(bad));
    if (bad) errors.push(`${label} must be between $0.50 and $10,000.00.`);
    return c ?? undefined;
  };

  const buildPayload = (): { payload?: Record<string, unknown>; errors: string[] } => {
    const errors: string[] = [];
    const type = amountType();
    const payload: Record<string, unknown> = {
      amountType: type,
      description: input('description').value.trim(),
      singleUse: input('singleUse').checked,
      collectPhone: input('collectPhone').checked,
      askPatientName: input('askPatientName').checked,
    };
    if (type === 'fixed') {
      payload.amountCents = readMoney('amount', true, errors, 'Amount');
    } else {
      payload.presetCents = readMoney('preset', false, errors, 'Suggested amount');
      payload.minimumCents = readMoney('minimum', false, errors, 'Minimum');
      payload.maximumCents = readMoney('maximum', false, errors, 'Maximum');
    }
    if (!payload.description) errors.push('Add a description.');
    for (const [name, label] of [
      ['patientRef', 'Patient reference'],
      ['invoice', 'Invoice number'],
    ] as const) {
      const el = input(name);
      const v = el.value.trim();
      el.setAttribute('aria-invalid', String(!el.validity.valid));
      if (!el.validity.valid) errors.push(`${label} can only use letters, numbers, and # . - /`);
      if (v) payload[name] = v;
    }
    return errors.length ? { errors } : { payload, errors };
  };

  const showStep = (step: 'form' | 'result') => {
    $('create-step').hidden = step !== 'form';
    $('result-step').hidden = step !== 'result';
  };

  const open = () => {
    showStep('form');
    setText(formError, '');
    dialog.showModal();
    (form.querySelector<HTMLInputElement>('input[name="amount"]') ?? form).focus();
  };

  const reset = () => {
    form.reset();
    pendingIdempotencyKey = null;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    syncAmountFields();
  };

  form.addEventListener('input', () => (pendingIdempotencyKey = null));
  form.addEventListener('change', syncAmountFields);
  syncAmountFields();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setText(formError, '');
    const { payload, errors } = buildPayload();
    if (!payload) {
      setText(formError, errors.join(' '));
      return;
    }
    // Same key for retries of the same submission; a new one after any edit or success.
    pendingIdempotencyKey ??= crypto.randomUUID();
    const btn = $<HTMLButtonElement>('create-btn');
    btn.disabled = true;
    try {
      const link = await api<{ url: string; amountDisplay: string }>('/api/payment-links', {
        method: 'POST',
        headers: { 'Idempotency-Key': pendingIdempotencyKey },
        body: JSON.stringify(payload),
      });
      pendingIdempotencyKey = null;
      const a = $<HTMLAnchorElement>('result-url');
      a.href = link.url;
      a.textContent = link.url;
      $('result-amount').textContent = link.amountDisplay;
      showStep('result');
      $('copy-btn').focus();
      onCreated();
    } catch (err) {
      if (handleAuthFailure(err)) {
        dialog.close();
        return;
      }
      const body = (err as { body?: { error?: string; fields?: string[] } }).body;
      if (body?.error === 'invalid_request' && body.fields?.length) {
        const names = body.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ');
        setText(formError, `Check these fields: ${names}.`);
      } else if (body?.error === 'stripe_rejected') {
        setText(formError, 'Stripe rejected the request. Check the amounts and try again.');
      } else {
        setText(
          formError,
          "Couldn't create the link: the server or Stripe is unavailable. Try again.",
        );
      }
    } finally {
      btn.disabled = false;
    }
  });

  $('copy-btn').addEventListener('click', (e) =>
    copyText($('result-url').textContent ?? '', e.currentTarget as HTMLElement),
  );
  $('create-another').addEventListener('click', () => {
    reset();
    showStep('form');
    form.querySelector<HTMLInputElement>('input[name="amount"]')?.focus();
  });
  dialog
    .querySelectorAll('[data-close]')
    .forEach((b) => b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', reset);

  return { open };
}
