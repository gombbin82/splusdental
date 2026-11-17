// Payments page: held payments to approve/release, and recent payments from our links.
import { $, api, handleAuthFailure, refreshHeldCount, setText, wireDialog } from './shell';
import { cardLabel, deadlineSoon } from './payments-utils';

export interface Payment {
  id: string;
  status: 'held' | 'paid' | 'released' | 'failed' | 'processing' | 'incomplete';
  amountDisplay: string;
  created: number;
  captureBefore: number | null;
  patientRef: string | null;
  invoice: string | null;
  payerName: string | null;
  payerEmail: string | null;
  card: { brand: string | null; last4: string | null } | null;
}

type Tab = 'held' | 'recent';

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const STATUS_LABEL: Record<Payment['status'], string> = {
  held: 'Needs approval',
  paid: 'Paid',
  released: 'Released',
  failed: 'Failed',
  processing: 'Processing',
  incomplete: 'Incomplete',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function headRow(cols: [string, string?][]) {
  const tr = el('tr');
  for (const [label, cls] of cols) {
    const th = el('th', label, cls ?? '');
    th.scope = 'col';
    tr.append(th);
  }
  return tr;
}

function payerCell(p: Payment) {
  const td = el('td', '', 'payer-cell');
  const box = el('span', '', 'payer');
  box.append(el('span', p.payerName || '—'));
  if (p.payerEmail) box.append(el('small', p.payerEmail));
  td.append(box);
  return td;
}

export function initPaymentsPage() {
  const head = $('payments-head');
  const body = $('payments-body');
  const tabs: Record<Tab, HTMLElement> = { held: $('tab-held'), recent: $('tab-recent') };
  let tab: Tab = location.hash === '#recent' ? 'recent' : 'held';

  const dialog = $<HTMLDialogElement>('confirm-dialog');
  const confirmBtn = $<HTMLButtonElement>('confirm-btn');
  wireDialog(dialog, () => confirmBtn.disabled);
  let pending: { p: Payment; action: 'capture' | 'cancel'; key: string } | null = null;

  const message = (text: string, cols: number) => {
    const tr = el('tr');
    const td = el('td', text, 'empty-row');
    td.colSpan = cols;
    tr.append(td);
    body.replaceChildren(tr);
  };

  const ref = (p: Payment) => [p.patientRef, p.invoice].filter(Boolean).join(' / ') || '—';

  const heldRow = (p: Payment) => {
    const tr = el('tr');
    const deadline = el('td', '', 'col-deadline');
    if (p.captureBefore) {
      const soon = deadlineSoon(p.captureBefore, Date.now());
      const span = el('span', dayFmt.format(new Date(p.captureBefore * 1000)), 'deadline');
      if (soon) span.classList.add('is-soon');
      span.title = soon ? 'Less than 2 days left: approve or release soon' : 'Approve by';
      deadline.append(span);
    }
    const actions = el('td', '', 'col-actions');
    const wrap = el('div', '', 'row-actions');
    const release = el('button', 'Release', 'btn btn-text btn-sm btn-danger-text');
    const approve = el('button', 'Approve', 'btn btn-filled btn-sm');
    release.type = approve.type = 'button';
    release.addEventListener('click', () => ask(p, 'cancel'));
    approve.addEventListener('click', () => ask(p, 'capture'));
    wrap.append(release, approve);
    actions.append(wrap);
    tr.append(
      el('td', dateFmt.format(new Date(p.created * 1000)), 'nowrap col-date'),
      payerCell(p),
      el('td', p.amountDisplay, 'num'),
      el('td', ref(p), 'col-ref'),
      el('td', cardLabel(p.card), 'col-card'),
      deadline,
      actions,
    );
    return tr;
  };

  const recentRow = (p: Payment) => {
    const tr = el('tr');
    const status = el('td', '', 'col-status');
    status.append(el('span', STATUS_LABEL[p.status], `status is-${p.status}`));
    tr.append(
      el('td', dateFmt.format(new Date(p.created * 1000)), 'nowrap col-date'),
      payerCell(p),
      el('td', p.amountDisplay, 'num'),
      el('td', ref(p), 'col-ref'),
      el('td', cardLabel(p.card), 'col-card'),
      status,
    );
    return tr;
  };

  async function load() {
    for (const [k, t] of Object.entries(tabs)) t.setAttribute('aria-selected', String(k === tab));
    $('panel').setAttribute('aria-labelledby', tabs[tab].id);
    const cols = tab === 'held' ? 7 : 6;
    head.replaceChildren(
      tab === 'held'
        ? headRow([
            ['Paid'],
            ['Payer', 'payer-cell'],
            ['Amount', 'num'],
            ['Reference'],
            ['Card'],
            ['Approve by'],
            [''],
          ])
        : headRow([
            ['Date'],
            ['Payer', 'payer-cell'],
            ['Amount', 'num'],
            ['Reference'],
            ['Card'],
            ['Status'],
          ]),
    );
    body.setAttribute('aria-busy', 'true');
    try {
      const { payments } = await api<{ payments: Payment[] }>(
        `/api/payments?status=${tab}&limit=50`,
      );
      if (!payments.length) {
        message(
          tab === 'held'
            ? 'Nothing to approve. Held payments show up here after a patient pays.'
            : 'No payments yet.',
          cols,
        );
      } else {
        body.replaceChildren(...payments.map(tab === 'held' ? heldRow : recentRow));
      }
    } catch (err) {
      if (!handleAuthFailure(err)) message("Couldn't load payments. Try refreshing.", cols);
    } finally {
      body.removeAttribute('aria-busy');
    }
  }

  function ask(p: Payment, action: 'capture' | 'cancel') {
    pending = { p, action, key: crypto.randomUUID() };
    const approve = action === 'capture';
    $('confirm-title').textContent = approve ? 'Approve and charge?' : 'Release this payment?';
    $('confirm-amount').textContent = p.amountDisplay;
    $('confirm-meta').textContent = [p.payerName, cardLabel(p.card), ref(p)]
      .filter((x) => x && x !== '—')
      .join(' · ');
    $('confirm-text').textContent = approve
      ? 'The full amount will be charged to the card now.'
      : 'The hold is cancelled and nothing is charged. A one-time link stays closed: create a new link if the patient still needs to pay.';
    confirmBtn.textContent = approve ? 'Approve' : 'Release';
    confirmBtn.className = approve ? 'btn btn-filled' : 'btn btn-filled btn-danger';
    setText($('confirm-error'), '');
    dialog.showModal();
  }

  confirmBtn.addEventListener('click', async () => {
    if (!pending) return;
    confirmBtn.disabled = true;
    setText($('confirm-error'), '');
    try {
      await api(`/api/payments/${encodeURIComponent(pending.p.id)}/${pending.action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': pending.key },
      });
      dialog.close();
      pending = null;
      void refreshHeldCount();
      await load();
    } catch (err) {
      if (handleAuthFailure(err)) {
        dialog.close();
        return;
      }
      const code = (err as { body?: { error?: string } }).body?.error;
      setText(
        $('confirm-error'),
        code === 'not_held'
          ? 'This payment is no longer waiting for approval. Refresh to see its status.'
          : "That didn't go through. Try again.",
      );
    } finally {
      confirmBtn.disabled = false;
    }
  });

  for (const [k, t] of Object.entries(tabs) as [Tab, HTMLElement][]) {
    t.addEventListener('click', () => {
      tab = k;
      history.replaceState(null, '', k === 'recent' ? '#recent' : location.pathname);
      void load();
    });
  }
  $('refresh').addEventListener('click', () => {
    void refreshHeldCount();
    void load();
  });
  void load();
}
