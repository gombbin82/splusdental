// Payment-link emails, sent through Gmail as the practice mailbox (e.g. info@splus.dental).
//
// Keyless domain-wide delegation: the Cloud Run runtime service account signs a JWT for itself via
// IAM Credentials `signJwt` (no key file), with `sub` = the mailbox and scope `gmail.send` only,
// exchanges it for an access token, and calls the Gmail API. A Workspace super admin must authorize
// the SA's client ID for that scope (see infra/README.md). Recipient addresses are never logged.
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import type { AppEnv } from './config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** Practice contact details shown in emails and on Stripe Checkout. Public business facts. */
export const PRACTICE = {
  name: 'S+ Dental',
  phone: '(425) 616-2331',
  email: 'info@splus.dental',
  address: '21005 44th Ave W Ste 103, Mountlake Terrace, WA 98043',
} as const;

/** One recipient, strict format, no header-injection characters. */
export const emailTo = z
  .string()
  .trim()
  .max(254)
  .regex(/^[^\s,;<>"]+$/, 'single address')
  .pipe(z.email());

export class EmailSendError extends Error {
  constructor(
    readonly step: 'sa' | 'sign' | 'token' | 'send',
    readonly status: number,
  ) {
    super(`email ${step} failed (${status})`);
  }
}

// ---------- MIME ----------

const CRLF = '\r\n';

function header(name: string, value: string) {
  if (/[\r\n]/.test(value)) throw new Error(`invalid ${name} header`);
  return `${name}: ${value}${CRLF}`;
}

function encodeWord(value: string) {
  if (/[\r\n]/.test(value)) throw new Error('invalid header value');
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Lines(s: string) {
  return (
    Buffer.from(s, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join(CRLF) ?? ''
  );
}

export function buildMime(m: EmailMessage & { from: string; fromName: string }): string {
  const boundary = `splus-${crypto.randomUUID()}`;
  return (
    header('From', `"${m.fromName}" <${m.from}>`) +
    header('Reply-To', m.from) +
    header('To', m.to) +
    header('Subject', encodeWord(m.subject)) +
    header('MIME-Version', '1.0') +
    header('Content-Type', `multipart/alternative; boundary="${boundary}"`) +
    CRLF +
    `--${boundary}${CRLF}` +
    header('Content-Type', 'text/plain; charset=UTF-8') +
    header('Content-Transfer-Encoding', 'base64') +
    CRLF +
    base64Lines(m.text) +
    CRLF +
    `--${boundary}${CRLF}` +
    header('Content-Type', 'text/html; charset=UTF-8') +
    header('Content-Transfer-Encoding', 'base64') +
    CRLF +
    base64Lines(m.html) +
    CRLF +
    `--${boundary}--${CRLF}`
  );
}

// ---------- content ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Generic payment-link email. No patient or health details — only the link and amount. */
export function paymentLinkEmail(opts: {
  url: string;
  amountDisplay: string;
  env: AppEnv;
}): Omit<EmailMessage, 'to'> {
  const fixed = opts.amountDisplay.startsWith('$');
  const amountLine = fixed
    ? `Amount: ${opts.amountDisplay}`
    : 'You can enter the amount on the payment page.';
  const subject = `${opts.env === 'prod' ? '' : '[TEST] '}Your S+ Dental payment link`;

  const text = [
    'Hello,',
    '',
    'Here is a secure link to pay your S+ Dental account balance:',
    opts.url,
    '',
    amountLine,
    'Payments are processed securely by Stripe.',
    '',
    "If you weren't expecting this, please call us before paying.",
    '',
    PRACTICE.name,
    PRACTICE.phone,
    PRACTICE.email,
    PRACTICE.address,
  ].join('\n');

  const url = esc(opts.url);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:bold;color:#2b4a8f;padding-bottom:16px">S+ Dental</td></tr>
<tr><td style="font-size:15px;line-height:1.5">Hello,<br><br>Here is a secure link to pay your S+ Dental account balance.</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-top:12px">${esc(amountLine)}</td></tr>
<tr><td style="padding:24px 0"><a href="${url}" style="display:inline-block;background:#3458a6;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:999px">Pay securely</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#5b6474">Payments are processed securely by Stripe. If the button doesn't work, copy this link:<br><a href="${url}" style="color:#3458a6;word-break:break-all">${url}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#5b6474;padding-top:16px">If you weren't expecting this, please call us before paying.</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#5b6474;padding-top:24px;border-top:1px solid #e3e7ef">${esc(PRACTICE.name)} · ${esc(PRACTICE.phone)} · ${esc(PRACTICE.email)}<br>${esc(PRACTICE.address)}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

// ---------- Gmail via keyless domain-wide delegation ----------

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GmailSenderOptions {
  /** Mailbox to send as (must be a licensed user in the Workspace domain). */
  sender: string;
  /** Runtime service account email (from config, or discovered from the metadata server). */
  serviceAccountEmail: () => Promise<string>;
  /** Access token of the runtime SA (cloud-platform scope) used to call IAM Credentials. */
  sourceToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createGmailSender(opts: GmailSenderOptions): EmailSender {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;

  async function gmailToken(): Promise<string> {
    if (cached && cached.expiresAt - 120_000 > now()) return cached.token;

    let sa: string;
    let source: string;
    try {
      sa = await opts.serviceAccountEmail();
      source = await opts.sourceToken();
    } catch {
      throw new EmailSendError('sa', 0);
    }
    const iat = Math.floor(now() / 1000);
    const claims = {
      iss: sa,
      sub: opts.sender,
      scope: GMAIL_SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    };

    const signRes = await doFetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(sa).replace(/%40/g, '@')}:signJwt`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${source}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: JSON.stringify(claims) }),
      },
    );
    if (!signRes.ok) throw new EmailSendError('sign', signRes.status);
    const { signedJwt } = (await signRes.json()) as { signedJwt: string };

    const tokenRes = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedJwt,
      }).toString(),
    });
    if (!tokenRes.ok) throw new EmailSendError('token', tokenRes.status);
    const tok = (await tokenRes.json()) as { access_token: string; expires_in: number };
    cached = { token: tok.access_token, expiresAt: now() + tok.expires_in * 1000 };
    return tok.access_token;
  }

  return {
    async send(msg) {
      const raw = Buffer.from(
        buildMime({ ...msg, from: opts.sender, fromName: PRACTICE.name }),
        'utf8',
      ).toString('base64url');
      const token = await gmailToken();
      const res = await doFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      if (res.status === 401) cached = null;
      if (!res.ok) throw new EmailSendError('send', res.status);
    },
  };
}

/** Production wiring: Application Default Credentials (the Cloud Run runtime SA). */
export function createDefaultGmailSender(sender: string, runtimeSaEmail: string): EmailSender {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return createGmailSender({
    sender,
    serviceAccountEmail: async () => {
      if (runtimeSaEmail) return runtimeSaEmail;
      const creds = await auth.getCredentials();
      if (!creds.client_email) throw new Error('runtime service account email unknown');
      return creds.client_email;
    },
    sourceToken: async () => {
      const t = await auth.getAccessToken();
      if (!t) throw new Error('no access token');
      return t;
    },
  });
}

// ---------- rate limit ----------

/** Sliding-window limiter per key (staff email). In-memory: per Cloud Run instance. */
export class SendRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max = 20,
    private readonly windowMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
