import { describe, expect, it, vi } from 'vitest';
import {
  EmailSendError,
  SendRateLimiter,
  buildMime,
  createGmailSender,
  emailTo,
  paymentLinkEmail,
} from '../src/email.js';

const decodeRaw = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

/** Decode every base64 body part of a MIME message (our builder base64-encodes both parts). */
function bodies(mime: string) {
  return [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map(
    (m) => Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'),
  );
}

describe('emailTo', () => {
  it('accepts a normal address and lower-cases nothing else', () => {
    expect(emailTo.parse(' Pat@Example.com ')).toBe('Pat@Example.com');
  });
  it.each([
    '',
    'nope',
    'a@b',
    'a@b.com, c@d.com',
    'a@b.com\r\nBcc: x@y.com',
    `${'a'.repeat(250)}@b.com`,
  ])('rejects %j', (v) => {
    expect(emailTo.safeParse(v).success).toBe(false);
  });
});

describe('buildMime', () => {
  const msg = {
    from: 'info@splus.dental',
    fromName: 'S+ Dental',
    to: 'pat@example.com',
    subject: 'Your S+ Dental payment link',
    text: 'Hello',
    html: '<p>Hello</p>',
  };

  it('builds multipart/alternative with From, Reply-To, To and base64 parts', () => {
    const mime = buildMime(msg);
    expect(mime).toContain('From: "S+ Dental" <info@splus.dental>\r\n');
    expect(mime).toContain('Reply-To: info@splus.dental\r\n');
    expect(mime).toContain('To: pat@example.com\r\n');
    expect(mime).toContain('Subject: Your S+ Dental payment link\r\n');
    expect(mime).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"/);
    expect(bodies(mime)).toEqual(['Hello', '<p>Hello</p>']);
  });

  it('RFC 2047-encodes a non-ASCII subject', () => {
    const mime = buildMime({ ...msg, subject: 'Payment — S+ Dental' });
    expect(mime).toContain(
      `Subject: =?UTF-8?B?${Buffer.from('Payment — S+ Dental').toString('base64')}?=\r\n`,
    );
  });

  it('refuses CR/LF in any header value', () => {
    expect(() => buildMime({ ...msg, to: 'a@b.com\r\nBcc: x@y.com' })).toThrow();
    expect(() => buildMime({ ...msg, subject: 'hi\nBcc: x@y.com' })).toThrow();
  });
});

describe('paymentLinkEmail', () => {
  it('fixed amount, prod: no [TEST], amount line, practice contact, link in text and html', () => {
    const m = paymentLinkEmail({
      url: 'https://buy.stripe.com/abc',
      amountDisplay: '$350.00',
      env: 'prod',
    });
    expect(m.subject).toBe('Your S+ Dental payment link');
    expect(m.text).toContain('https://buy.stripe.com/abc');
    expect(m.text).toContain('Amount: $350.00');
    expect(m.text).toContain('(425) 616-2331');
    expect(m.text).toContain("If you weren't expecting this, please call us before paying.");
    expect(m.html).toContain('href="https://buy.stripe.com/abc"');
  });

  it('patient-entered amount and non-prod subject prefix', () => {
    const m = paymentLinkEmail({
      url: 'https://buy.stripe.com/x',
      amountDisplay: 'Patient enters amount',
      env: 'staging',
    });
    expect(m.subject).toBe('[TEST] Your S+ Dental payment link');
    expect(m.text).toContain('You can enter the amount on the payment page.');
    expect(m.text).not.toContain('Amount: Patient');
  });

  it('escapes HTML in the url', () => {
    const m = paymentLinkEmail({
      url: 'https://x.test/?a=1&b="2"',
      amountDisplay: '$1.00',
      env: 'prod',
    });
    expect(m.html).toContain('https://x.test/?a=1&amp;b=&quot;2&quot;');
    expect(m.html).not.toContain('b="2"');
  });
});

describe('createGmailSender (keyless domain-wide delegation)', () => {
  function setup(overrides: { tokenStatus?: number; sendStatus?: number } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    let now = 1_700_000_000_000;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url);
      calls.push({ url: u, init });
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (u.includes(':signJwt')) return json({ signedJwt: 'signed.jwt.value' });
      if (u === 'https://oauth2.googleapis.com/token') {
        return json(
          { access_token: 'gmail-token', expires_in: 3600 },
          overrides.tokenStatus ?? 200,
        );
      }
      if (u.startsWith('https://gmail.googleapis.com/')) {
        return json({ id: 'm1' }, overrides.sendStatus ?? 200);
      }
      return json({}, 404);
    });
    const sender = createGmailSender({
      sender: 'info@splus.dental',
      serviceAccountEmail: async () => 'api@proj.iam.gserviceaccount.com',
      sourceToken: async () => 'source-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });
    return { sender, calls, advance: (ms: number) => (now += ms) };
  }

  const msg = { to: 'pat@example.com', subject: 'S', text: 't', html: '<p>h</p>' };

  it('signs a JWT as the runtime SA for sub=sender, exchanges it, and sends via Gmail', async () => {
    const { sender, calls } = setup();
    await sender.send(msg);

    const sign = calls[0]!;
    expect(sign.url).toBe(
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/api@proj.iam.gserviceaccount.com:signJwt',
    );
    expect((sign.init.headers as Record<string, string>).Authorization).toBe('Bearer source-token');
    const claims = JSON.parse(JSON.parse(String(sign.init.body)).payload);
    expect(claims).toEqual({
      iss: 'api@proj.iam.gserviceaccount.com',
      sub: 'info@splus.dental',
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });

    const token = calls[1]!;
    expect(token.url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(token.init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')).toBe('signed.jwt.value');

    const send = calls[2]!;
    expect(send.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect((send.init.headers as Record<string, string>).Authorization).toBe('Bearer gmail-token');
    const mime = decodeRaw(JSON.parse(String(send.init.body)).raw);
    expect(mime).toContain('From: "S+ Dental" <info@splus.dental>');
    expect(mime).toContain('To: pat@example.com');
  });

  it('caches the Gmail token until shortly before expiry', async () => {
    const { sender, calls, advance } = setup();
    await sender.send(msg);
    await sender.send(msg);
    expect(calls.filter((c) => c.url.includes(':signJwt'))).toHaveLength(1);
    advance(3600 * 1000);
    await sender.send(msg);
    expect(calls.filter((c) => c.url.includes(':signJwt'))).toHaveLength(2);
  });

  it('throws EmailSendError (status only, no response body) when Gmail or the token exchange fails', async () => {
    await expect(setup({ sendStatus: 400 }).sender.send(msg)).rejects.toBeInstanceOf(
      EmailSendError,
    );
    await expect(setup({ tokenStatus: 401 }).sender.send(msg)).rejects.toMatchObject({
      step: 'token',
      status: 401,
    });
  });
});

describe('SendRateLimiter', () => {
  it('allows N per window per key, then refuses until the window slides', () => {
    let now = 0;
    const rl = new SendRateLimiter(2, 1000, () => now);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
    expect(rl.take('b')).toBe(true);
    now = 1001;
    expect(rl.take('a')).toBe(true);
  });
});
