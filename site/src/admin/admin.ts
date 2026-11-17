// Staff admin client. Vanilla TS, no framework.
// Auth: Google Identity Services gives us an ID token; we send it as a Bearer token and the API
// verifies it (signature, audience, email_verified, hd). Anything checked here is UX only.

interface PublicConfig {
  googleClientId: string;
  adminHd: string;
  stripeMode: 'test' | 'live';
  env: 'dev' | 'staging' | 'prod';
}

interface LinkRow {
  id: string;
  url: string;
  active: boolean;
  amountDisplay: string;
  description: string | null;
  metadata: Record<string, string>;
  created: number | null;
}

interface GsiCredentialResponse {
  credential: string;
}

interface Gsi {
  accounts: {
    id: {
      initialize(opts: {
        client_id: string;
        callback: (r: GsiCredentialResponse) => void;
        hd?: string;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        use_fedcm_for_prompt?: boolean;
      }): void;
      renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
      prompt(): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: Gsi;
  }
}

const TOKEN_KEY = 'splus-admin-id-token';
const MIN_CENTS = 50;
const MAX_CENTS = 1_000_000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const views = {
  loading: $('loading-view'),
  signin: $('signin-view'),
  app: $('app-view'),
};

function show(view: keyof typeof views) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  $('who').hidden = view !== 'app';
}

function setText(el: HTMLElement, text: string) {
  el.textContent = text;
  el.hidden = text === '';
}

// ---------- token (memory + sessionStorage, cleared on sign-out / tab close) ----------

let idToken: string | null = null;

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function storeToken(token: string | null) {
  idToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: keep the token in memory only
  }
}

function restoreToken(): string | null {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    // Treat tokens within a minute of expiry as expired.
    if (t && tokenExpiry(t) > Date.now() + 60_000) return t;
  } catch {
    // ignore
  }
  return null;
}

// ---------- API ----------

class AuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(`auth ${status}`);
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { body });
  return body as T;
}

function handleAuthFailure(err: unknown): boolean {
  if (!(err instanceof AuthError)) return false;
  storeToken(null);
  signinError(
    err.status === 403
      ? 'That account is not allowed. Use your @splus.dental Google Workspace account.'
      : 'Your session expired. Please sign in again.',
  );
  show('signin');
  window.google?.accounts.id.prompt();
  return true;
}

function signinError(msg: string) {
  setText($('signin-error'), msg);
}

// ---------- sign-in ----------

let config: PublicConfig;

async function onCredential(r: GsiCredentialResponse) {
  storeToken(r.credential);
  await enterApp();
}

async function enterApp() {
  try {
    const me = await api<{ email: string; name: string }>('/api/me');
    $('who-email').textContent = me.email;
    signinError('');
    show('app');
    void loadLinks();
  } catch (err) {
    if (!handleAuthFailure(err)) {
      signinError('Could not reach the server. Try again in a moment.');
      show('signin');
    }
  }
}

function waitForGsi(): Promise<Gsi> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else if (Date.now() - started > 10_000) reject(new Error('gsi'));
      else setTimeout(tick, 50);
    };
    tick();
  });
}

function signOut() {
  storeToken(null);
  window.google?.accounts.id.disableAutoSelect();
  $('who-email').textContent = '';
  $('links-body').replaceChildren();
  $('result').hidden = true;
  signinError('');
  show('signin');
}

function renderBanner() {
  const parts: string[] = [];
  if (config.env !== 'prod') parts.push(`Environment: ${config.env}.`);
  if (config.stripeMode === 'test') {
    parts.push(
      'Stripe TEST mode — links will not charge real cards (use card 4242 4242 4242 4242).',
    );
  }
  setText($('mode-banner'), parts.join(' '));
}

// ---------- create form ----------

const form = $<HTMLFormElement>('link-form');
let pendingIdempotencyKey: string | null = null;

/** "$1,234.5" -> 123450 cents; null for blank; NaN for invalid. */
function toCents(raw: string): number | null {
  const v = raw.trim().replace(/[$,\s]/g, '');
  if (v === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
  const [d, f = ''] = v.split('.');
  return Number(d) * 100 + Number(f.padEnd(2, '0'));
}

function amountType(): 'fixed' | 'customer' {
  return (form.elements.namedItem('amountType') as RadioNodeList).value as 'fixed' | 'customer';
}

function syncAmountFields() {
  const type = amountType();
  form.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => {
    el.hidden = el.dataset.show !== type;
  });
}

function input(name: string) {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function readMoney(name: string, required: boolean, errors: string[], label: string) {
  const el = input(name);
  const c = toCents(el.value);
  const bad =
    (c === null && required) || (c !== null && (Number.isNaN(c) || c < MIN_CENTS || c > MAX_CENTS));
  el.setAttribute('aria-invalid', String(bad));
  if (bad) errors.push(`${label} must be between $0.50 and $10,000.00.`);
  return c ?? undefined;
}

function buildPayload(): { payload?: Record<string, unknown>; errors: string[] } {
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
  if (!payload.description) errors.push('Description is required.');
  for (const [name, label] of [
    ['patientRef', 'Patient reference'],
    ['invoice', 'Invoice #'],
  ] as const) {
    const el = input(name);
    const v = el.value.trim();
    el.setAttribute('aria-invalid', String(!el.validity.valid));
    if (!el.validity.valid) errors.push(`${label} has characters that aren't allowed.`);
    if (v) payload[name] = v;
  }
  return errors.length ? { errors } : { payload, errors };
}

const FIELD_LABELS: Record<string, string> = {
  amountCents: 'amount',
  presetCents: 'suggested amount',
  minimumCents: 'minimum',
  maximumCents: 'maximum',
  description: 'description',
  patientRef: 'patient reference',
  invoice: 'invoice #',
};

async function onSubmit(e: SubmitEvent) {
  e.preventDefault();
  const formError = $('form-error');
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
    $('result').hidden = false;
    $('copy-btn').textContent = 'Copy';
    void loadLinks();
  } catch (err) {
    if (handleAuthFailure(err)) return;
    const body = (err as { body?: { error?: string; fields?: string[] } }).body;
    if (body?.error === 'invalid_request' && body.fields?.length) {
      const names = body.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ');
      setText(formError, `Please check: ${names}.`);
    } else if (body?.error === 'stripe_rejected') {
      setText(formError, 'Stripe rejected the request. Check the amounts and try again.');
    } else {
      setText(formError, 'Could not create the link (server or Stripe unavailable). Try again.');
    }
  } finally {
    btn.disabled = false;
  }
}

async function copy(text: string, btn: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 2000);
}

// ---------- recent links ----------

const dateFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function cell(text: string, className?: string) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function messageRow(text: string) {
  const tr = document.createElement('tr');
  const td = cell(text, 'muted');
  td.colSpan = 7;
  tr.append(td);
  $('links-body').replaceChildren(tr);
}

function linkRow(l: LinkRow) {
  const tr = document.createElement('tr');
  const ref = [l.metadata.patient_ref, l.metadata.invoice].filter(Boolean).join(' · ');
  const by = (l.metadata.created_by ?? '').split('@')[0] ?? '';

  const status = document.createElement('span');
  status.className = `pill ${l.active ? 'on' : 'off'}`;
  status.textContent = l.active ? 'Active' : 'Inactive';
  const statusTd = document.createElement('td');
  statusTd.append(status);

  const actions = document.createElement('td');
  actions.className = 'nowrap';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'linkbtn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => void copy(l.url, copyBtn));
  actions.append(copyBtn);
  if (l.active) {
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'linkbtn danger';
    off.textContent = 'Deactivate';
    off.addEventListener('click', () => void deactivate(l, off));
    actions.append(off);
  }

  tr.append(
    cell(l.created ? dateFmt.format(new Date(l.created * 1000)) : '—', 'nowrap'),
    cell(l.description ?? ''),
    cell(l.amountDisplay, 'nowrap'),
    cell(ref || '—'),
    cell(by),
    statusTd,
    actions,
  );
  return tr;
}

async function loadLinks() {
  try {
    const { links } = await api<{ links: LinkRow[] }>('/api/payment-links?limit=25');
    if (!links.length) return messageRow('No links yet.');
    $('links-body').replaceChildren(...links.map(linkRow));
  } catch (err) {
    if (!handleAuthFailure(err)) messageRow('Could not load links.');
  }
}

async function deactivate(l: LinkRow, btn: HTMLButtonElement) {
  if (
    !confirm(
      `Deactivate this ${l.amountDisplay} link? Patients will no longer be able to pay with it.`,
    )
  ) {
    return;
  }
  btn.disabled = true;
  try {
    await api(`/api/payment-links/${encodeURIComponent(l.id)}/deactivate`, { method: 'POST' });
    await loadLinks();
  } catch (err) {
    if (!handleAuthFailure(err)) {
      btn.disabled = false;
      alert('Could not deactivate the link. Try again.');
    }
  }
}

// ---------- boot ----------

async function boot() {
  form.addEventListener('submit', (e) => void onSubmit(e));
  form.addEventListener('input', () => (pendingIdempotencyKey = null));
  form.addEventListener('change', syncAmountFields);
  $('signout').addEventListener('click', signOut);
  $('refresh').addEventListener('click', () => void loadLinks());
  $('copy-btn').addEventListener('click', (e) =>
    copy($('result-url').textContent ?? '', e.currentTarget as HTMLElement),
  );
  syncAmountFields();

  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(String(res.status));
    config = (await res.json()) as PublicConfig;
  } catch {
    show('signin');
    signinError('The admin service is unavailable. Try again later.');
    return;
  }
  renderBanner();

  if (!config.googleClientId) {
    show('signin');
    signinError('Sign-in is not configured (missing Google OAuth client ID).');
    return;
  }

  let gsi: Gsi;
  try {
    gsi = await waitForGsi();
  } catch {
    show('signin');
    signinError('Could not load Google sign-in. Check your connection or ad blocker.');
    return;
  }
  gsi.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: (r) => void onCredential(r),
    hd: config.adminHd, // UX hint only; the server enforces the domain
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
  });
  gsi.accounts.id.renderButton($('gsi-button'), {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
  });

  const saved = restoreToken();
  if (saved) {
    idToken = saved;
    await enterApp();
  } else {
    storeToken(null);
    show('signin');
  }
}

void boot();

export {};
