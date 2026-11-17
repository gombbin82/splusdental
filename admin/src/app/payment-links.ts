// Payment links: recent-links table (full and compact) and the create dialog.
import { inRange, toCents } from './money';
import { $, api, handleAuthFailure, setText, wireDialog } from './shell';

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
function iconButton(tpl: 'tpl-copy' | 'tpl-deactivate' | 'tpl-email') {
  const t = $<HTMLTemplateElement>(tpl);
  return t.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
}

export class LinksTable {
  constructor(
    private readonly body: HTMLElement,
    private readonly opts: {
      limit: number;
      compact?: boolean;
      columns: number;
      /** Show an "Email link" action on active links. */
      onEmail?: (l: LinkRow) => void;
    },
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
    if (l.active && this.opts.onEmail) {
      const mailBtn = iconButton('tpl-email');
      mailBtn.addEventListener('click', () => this.opts.onEmail?.(l));
      actions.append(mailBtn);
    }
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
      holdForApproval: input('holdForApproval').checked,
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
    const emailEl = form.elements.namedItem('emailTo') as HTMLInputElement | null;
    if (emailEl && !emailEl.closest('[hidden]')) {
      const v = emailEl.value.trim();
      const bad = v !== '' && !emailEl.validity.valid;
      emailEl.setAttribute('aria-invalid', String(bad));
      if (bad) errors.push('Enter a valid patient email, or leave it blank.');
      if (v && !bad) payload.emailTo = v;
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
      const link = await api<{
        url: string;
        amountDisplay: string;
        emailed?: boolean;
        emailError?: string;
      }>('/api/payment-links', {
        method: 'POST',
        headers: { 'Idempotency-Key': pendingIdempotencyKey },
        body: JSON.stringify(payload),
      });
      pendingIdempotencyKey = null;
      const a = $<HTMLAnchorElement>('result-url');
      a.href = link.url;
      a.textContent = link.url;
      $('result-amount').textContent = link.amountDisplay;
      const emailNote = $('result-email');
      emailNote.className = 'result-email';
      if (payload.emailTo && link.emailed) {
        emailNote.classList.add('is-ok');
        setText($('result-email-text'), `Emailed to ${String(payload.emailTo)}`);
        emailNote.hidden = false;
      } else if (payload.emailTo) {
        emailNote.classList.add('is-error');
        setText(
          $('result-email-text'),
          link.emailError === 'rate_limited'
            ? 'Link created, but the email limit was reached. Copy the link or try again later.'
            : "Link created, but the email didn't send. Copy the link or use Email link to retry.",
        );
        emailNote.hidden = false;
      } else {
        emailNote.hidden = true;
      }
      $('hold-note').hidden = !payload.holdForApproval;
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
  wireDialog(dialog, () => $<HTMLButtonElement>('create-btn').disabled);
  dialog.addEventListener('close', reset);

  return { open };
}

// ---------- email an existing link ----------

export function initEmailDialog(onSent: () => void) {
  const dialog = $<HTMLDialogElement>('email-dialog');
  const form = $<HTMLFormElement>('email-form');
  const to = form.elements.namedItem('to') as HTMLInputElement;
  const error = $('email-error');
  const btn = $<HTMLButtonElement>('email-send');
  let current: LinkRow | null = null;

  wireDialog(dialog, () => btn.disabled);
  dialog.addEventListener('close', () => {
    form.reset();
    to.removeAttribute('aria-invalid');
    setText(error, '');
    current = null;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return;
    setText(error, '');
    const value = to.value.trim();
    if (!value || !to.validity.valid) {
      to.setAttribute('aria-invalid', 'true');
      setText(error, 'Enter a valid email address.');
      return;
    }
    btn.disabled = true;
    try {
      await api(`/api/payment-links/${encodeURIComponent(current.id)}/email`, {
        method: 'POST',
        body: JSON.stringify({ to: value }),
      });
      dialog.close();
      onSent();
    } catch (err) {
      if (handleAuthFailure(err)) {
        dialog.close();
        return;
      }
      const code = (err as { body?: { error?: string } }).body?.error;
      setText(
        error,
        code === 'rate_limited'
          ? 'Too many emails sent in the last hour. Try again later or copy the link.'
          : code === 'link_inactive'
            ? 'This link is no longer active.'
            : "The email didn't send. Try again, or copy the link and send it yourself.",
      );
    } finally {
      btn.disabled = false;
    }
  });

  return {
    open(l: LinkRow) {
      current = l;
      $('email-amount').textContent = l.amountDisplay;
      dialog.showModal();
      to.focus();
    },
  };
}
