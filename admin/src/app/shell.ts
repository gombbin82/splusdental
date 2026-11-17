// App shell client: Google sign-in, session token, the signed-in user, and the chrome around every
// page (env chips, account menu, mobile drawer, admin-only sections).
//
// Auth: Google Identity Services gives us an ID token; we send it as a Bearer token and the API
// verifies it (signature, audience, email_verified) and checks the email against the admin/staff
// allowlists. Everything checked here is UX only — the server enforces access on every request.

import { initials } from './shell-utils';

export type Role = 'admin' | 'staff';

export interface PublicConfig {
  googleClientId: string;
  stripeMode: 'test' | 'live';
  env: 'dev' | 'staging' | 'prod';
  /** Emailing payment links is configured (GMAIL_SENDER set on the API). */
  emailEnabled?: boolean;
}

export interface Me {
  email: string;
  name: string;
  role: Role;
}

export interface ShellContext {
  me: Me;
  config: PublicConfig;
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

export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export function setText(el: HTMLElement, text: string) {
  el.textContent = text;
  el.hidden = text === '';
}

// ---------- views ----------

type View = 'loading' | 'signin' | 'app';

function show(view: View) {
  $('loading-view').hidden = view !== 'loading';
  $('signin-view').hidden = view !== 'signin';
  $('app-view').hidden = view !== 'app';
}

function signinError(msg: string) {
  setText($('signin-error'), msg);
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

export class AuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(`auth ${status}`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (idToken) headers.set('Authorization', `Bearer ${idToken}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  // A 403 from an admin-only route means "signed in, but not an admin": not a session problem.
  if (res.status === 401 || (res.status === 403 && body.error !== 'admin_only')) {
    throw new AuthError(res.status as 401 | 403);
  }
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { body });
  return body as T;
}

/** Sends the user back to sign-in on 401/403. Returns true if it handled the error. */
export function handleAuthFailure(err: unknown): boolean {
  if (!(err instanceof AuthError)) return false;
  storeToken(null);
  signinError(
    err.status === 403
      ? 'That account does not have access. Ask a practice admin to add your email.'
      : 'Your session expired. Sign in again to continue.',
  );
  show('signin');
  window.google?.accounts.id.prompt();
  return true;
}

// ---------- dialogs ----------

/**
 * Close a <dialog> on Escape (native), on [data-close] buttons, and on a backdrop click. The dialog
 * has no padding, so a click whose target is the <dialog> itself landed outside the content; the
 * press must start there too (a text selection dragged out of a field doesn't close it), and it
 * stays open while `isBusy()` (a request in flight).
 */
export function wireDialog(dialog: HTMLDialogElement, isBusy: () => boolean = () => false) {
  dialog
    .querySelectorAll('[data-close]')
    .forEach((b) => b.addEventListener('click', () => dialog.close()));
  let pressedOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => {
    pressedOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && pressedOnBackdrop && !isBusy()) dialog.close();
    pressedOnBackdrop = false;
  });
  dialog.addEventListener('cancel', (e) => {
    if (isBusy()) e.preventDefault();
  });
}

// ---------- held-payments badge ----------

/** Update the "Payments" nav badge (and anything else marked data-held-count). */
export async function refreshHeldCount(): Promise<number | null> {
  try {
    const { payments } = await api<{ payments: unknown[] }>('/api/payments?status=held&limit=100');
    const n = payments.length;
    document.querySelectorAll<HTMLElement>('[data-held-badge]').forEach((el) => {
      el.textContent = n > 99 ? '99+' : String(n);
      el.hidden = n === 0;
      el.setAttribute('aria-label', `${n} need approval`);
    });
    document.dispatchEvent(new CustomEvent('held-count', { detail: n }));
    return n;
  } catch {
    return null;
  }
}

// ---------- ready hooks for page scripts ----------

let ctx: ShellContext | null = null;
const readyHandlers: ((c: ShellContext) => void | Promise<void>)[] = [];

/** Run `fn` once the user is signed in (immediately if already). */
export function onReady(fn: (c: ShellContext) => void | Promise<void>) {
  if (ctx) void fn(ctx);
  else readyHandlers.push(fn);
}

// ---------- chrome ----------

function renderChips(config: PublicConfig) {
  const env = $('env-chip');
  setText(env, config.env === 'prod' ? '' : config.env === 'staging' ? 'Staging' : 'Local');
  setText($('mode-chip'), config.stripeMode === 'test' ? 'Test mode' : '');
}

function renderUser(me: Me) {
  const ini = initials(me.name, me.email);
  $('avatar').textContent = ini;
  $('avatar-lg').textContent = ini;
  $('avatar').setAttribute('aria-label', `Account: ${me.name}`);
  $('acct-name').textContent = me.name;
  $('acct-email').textContent = me.email;
  $('acct-role').textContent = me.role === 'admin' ? 'Admin' : 'Staff';
  document.body.dataset.role = me.role;
  document.querySelectorAll<HTMLElement>('[data-admin]').forEach((el) => {
    el.hidden = me.role !== 'admin';
  });
  const firstName = me.name && me.name !== me.email ? me.name.split(' ')[0] : '';
  document.querySelectorAll<HTMLElement>('[data-first-name]').forEach((el) => {
    el.textContent = firstName ? `, ${firstName}` : '';
  });

  // Admin-only pages: staff see a friendly explanation instead of the page.
  const adminOnly = document.body.dataset.adminOnly === 'true';
  const denied = adminOnly && me.role !== 'admin';
  $('page-content').hidden = denied;
  $('admins-only').hidden = !denied;
}

function initAccountMenu() {
  const btn = $<HTMLButtonElement>('avatar');
  const menu = $('account-menu');
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) $('signout').focus();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      close();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      btn.focus();
    }
  });
  $('signout').addEventListener('click', signOut);
}

function initDrawer() {
  const btn = $<HTMLButtonElement>('menu-btn');
  const rail = $('rail');
  const scrim = $('scrim');
  const setOpen = (open: boolean) => {
    document.body.classList.toggle('drawer-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) rail.querySelector<HTMLElement>('a')?.focus();
  };
  btn.addEventListener('click', () => setOpen(!document.body.classList.contains('drawer-open')));
  scrim.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) {
      setOpen(false);
      btn.focus();
    }
  });
}

// ---------- sign-in / out ----------

async function enterApp(config: PublicConfig) {
  try {
    const me = await api<Me>('/api/me');
    ctx = { me, config };
    renderUser(me);
    signinError('');
    show('app');
    void refreshHeldCount();
    for (const fn of readyHandlers.splice(0)) await fn(ctx);
  } catch (err) {
    if (!handleAuthFailure(err)) {
      signinError("Couldn't reach the admin service. Check your connection and try again.");
      show('signin');
    }
  }
}

function signOut() {
  storeToken(null);
  window.google?.accounts.id.disableAutoSelect();
  // Reload to drop all page state; the sign-in view shows because the token is gone.
  window.location.href = '/';
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

async function boot() {
  initAccountMenu();
  initDrawer();

  let config: PublicConfig;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(String(res.status));
    config = (await res.json()) as PublicConfig;
  } catch {
    show('signin');
    signinError('The admin service is unavailable right now. Try again in a few minutes.');
    return;
  }
  renderChips(config);

  if (!config.googleClientId) {
    show('signin');
    signinError('Sign-in is not set up yet: the Google OAuth client ID is missing.');
    return;
  }

  const saved = restoreToken();
  if (saved) {
    idToken = saved;
    await enterApp(config);
  }

  let gsi: Gsi;
  try {
    gsi = await waitForGsi();
  } catch {
    if (!ctx) {
      show('signin');
      signinError("Google sign-in didn't load. Check your connection or ad blocker.");
    }
    return;
  }
  gsi.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: (r) => {
      storeToken(r.credential);
      void enterApp(config);
    },
    auto_select: true,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
  });
  gsi.accounts.id.renderButton($('gsi-button'), {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    width: 280,
  });

  if (!ctx) {
    storeToken(null);
    show('signin');
  }
}

void boot();
