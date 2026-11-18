import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLogSink, type LogSink } from '../src/log.js';
import { authHeaders, fakeEmail, fakeLink, fakeStripe, testApp } from './helpers/app.js';
import { SendRateLimiter } from '../src/email.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const firstArg = (fn: { mock: { calls: unknown[] } }) => (fn.mock.calls[0] as Loose[])[0]!;

const IDEM = '6f1c2f7e-1b7a-4f5e-9d3c-2a6b8e0f4c11';

let lines: string[];
let prevSink: LogSink;
beforeEach(() => {
  lines = [];
  prevSink = setLogSink((l) => lines.push(l));
});
afterEach(() => {
  setLogSink(prevSink);
});

function post(
  stripe: ReturnType<typeof fakeStripe>,
  body: unknown,
  idem: string | null = IDEM,
  extra: Parameters<typeof testApp>[2] = {},
) {
  const headers: Record<string, string> = authHeaders({ 'Content-Type': 'application/json' });
  if (idem) headers['Idempotency-Key'] = idem;
  return testApp(stripe, undefined, extra).request('/api/payment-links', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/payment-links', () => {
  it('creates a fixed-amount price and a one-time payment link with safe defaults', async () => {
    const stripe = fakeStripe();
    const res = await post(stripe, {
      amountType: 'fixed',
      amountCents: 35000,
      patientRef: 'AB-1042',
      invoice: '2026-1142',
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'plink_1',
      url: 'https://buy.stripe.com/test_abc',
      active: true,
      amountDisplay: '$350.00',
    });

    const metadata = {
      source: 'splus-admin',
      patient_ref: 'AB-1042',
      invoice: '2026-1142',
      created_by: 'frontdesk@splus.dental',
      amount_display: '$350.00',
      env: 'staging',
    };
    expect(stripe.products.create).toHaveBeenCalledWith(
      {
        name: 'S+ Dental — account balance',
        metadata,
      },
      { idempotencyKey: `${IDEM}:product` },
    );
    expect(stripe.prices.create).toHaveBeenCalledWith(
      { currency: 'usd', unit_amount: 35000, product: 'prod_1', metadata },
      { idempotencyKey: `${IDEM}:price` },
    );
    expect(firstArg(stripe.prices.create)).not.toHaveProperty('product_data');
    expect(stripe.paymentLinks.create).toHaveBeenCalledWith(
      {
        line_items: [{ price: 'price_1', quantity: 1 }],
        payment_method_types: ['card'],
        after_completion: {
          type: 'redirect',
          redirect: { url: 'https://staging.splus.dental/thank-you' },
        },
        restrictions: { completed_sessions: { limit: 1 } },
        phone_number_collection: { enabled: false },
        custom_text: {
          submit: { message: 'Questions about your balance? Call S+ Dental at (425) 616-2331.' },
        },
        metadata,
        payment_intent_data: { metadata },
      },
      { idempotencyKey: `${IDEM}:link` },
    );
  });

  it('supports patient-entered amounts with preset/min/max, phone, and patient name field', async () => {
    const stripe = fakeStripe();
    const res = await post(stripe, {
      amountType: 'customer',
      presetCents: 20000,
      minimumCents: 100,
      maximumCents: 50000,
      description: 'S+ Dental — payment',
      singleUse: false,
      collectPhone: true,
      askPatientName: true,
    });

    expect(res.status).toBe(201);
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        custom_unit_amount: { enabled: true, preset: 20000, minimum: 100, maximum: 50000 },
        product: 'prod_1',
        metadata: expect.objectContaining({ amount_display: 'Patient enters amount' }),
      }),
      expect.anything(),
    );
    const linkParams = (
      stripe.paymentLinks.create.mock.calls as unknown[][]
    )[0]![0] as Stripe.PaymentLinkCreateParams;
    expect(linkParams.restrictions).toBeUndefined();
    expect(linkParams.phone_number_collection).toEqual({ enabled: true });
    expect(linkParams.custom_fields).toEqual([
      {
        key: 'patientname',
        label: { type: 'custom', custom: 'Patient name' },
        type: 'text',
        optional: false,
      },
    ]);
    expect(linkParams.metadata).not.toHaveProperty('patient_ref');
    expect(linkParams.metadata).not.toHaveProperty('invoice');
  });

  it('omits unset custom_unit_amount bounds', async () => {
    const stripe = fakeStripe();
    expect((await post(stripe, { amountType: 'customer' })).status).toBe(201);
    expect(stripe.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ custom_unit_amount: { enabled: true } }),
      expect.anything(),
    );
  });

  it.each([
    ['missing amount for fixed', { amountType: 'fixed' }],
    ['amount below Stripe minimum', { amountType: 'fixed', amountCents: 49 }],
    ['amount above cap', { amountType: 'fixed', amountCents: 1_000_001 }],
    ['fractional cents', { amountType: 'fixed', amountCents: 100.5 }],
    ['unknown amount type', { amountType: 'subscription', amountCents: 100 }],
    ['preset below minimum', { amountType: 'customer', presetCents: 100, minimumCents: 200 }],
    ['maximum below minimum', { amountType: 'customer', minimumCents: 500, maximumCents: 100 }],
    [
      'description too long',
      { amountType: 'fixed', amountCents: 100, description: 'x'.repeat(121) },
    ],
    ['blank description', { amountType: 'fixed', amountCents: 100, description: '   ' }],
    [
      'control chars in description',
      { amountType: 'fixed', amountCents: 100, description: 'a\nb' },
    ],
    ['patient_ref too long', { amountType: 'fixed', amountCents: 100, patientRef: 'x'.repeat(21) }],
    [
      'patient_ref with spaces/names',
      { amountType: 'fixed', amountCents: 100, patientRef: 'John Smith' },
    ],
    ['invoice with odd chars', { amountType: 'fixed', amountCents: 100, invoice: 'inv<script>' }],
    ['unknown field', { amountType: 'fixed', amountCents: 100, note: 'root canal' }],
  ])('400 for %s', async (_name, body) => {
    const stripe = fakeStripe();
    const res = await post(stripe, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it('400 for a non-JSON body', async () => {
    const res = await testApp().request('/api/payment-links', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': IDEM }),
      body: '{nope',
    });
    expect(res.status).toBe(400);
  });

  it('400 when the Idempotency-Key header is missing or not a UUID', async () => {
    const body = { amountType: 'fixed', amountCents: 100 };
    expect((await post(fakeStripe(), body, null)).status).toBe(400);
    expect((await post(fakeStripe(), body, 'abc')).status).toBe(400);
  });

  it('maps a Stripe invalid-request error to 400 without leaking the message', async () => {
    const stripe = fakeStripe();
    stripe.prices.create.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'secret internal detail',
      }),
    );
    const res = await post(stripe, { amountType: 'fixed', amountCents: 100 });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('secret internal detail');
    expect(JSON.parse(text)).toEqual({ error: 'stripe_rejected' });
  });

  it('maps Stripe connectivity/API errors to 502', async () => {
    const stripe = fakeStripe();
    stripe.paymentLinks.create.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({ type: 'api_error', message: 'boom' }),
    );
    const res = await post(stripe, { amountType: 'fixed', amountCents: 100 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'stripe_unavailable' });
  });

  it('logs the creating staff email but not patient refs', async () => {
    await post(fakeStripe(), { amountType: 'fixed', amountCents: 100, patientRef: 'ZZ-99' });
    const entry = lines.map((l) => JSON.parse(l)).find((e) => e.message === 'payment_link.created');
    expect(entry).toMatchObject({ staff: 'frontdesk@splus.dental', paymentLinkId: 'plink_1' });
    expect(lines.join('\n')).not.toContain('ZZ-99');
  });
});

describe('GET /api/payment-links', () => {
  it('lists only links created by the admin tool (Stripe order: newest first), limited', async () => {
    const stripe = fakeStripe();
    stripe.paymentLinks.list.mockResolvedValueOnce({
      object: 'list',
      has_more: false,
      data: [
        fakeLink({ id: 'plink_other', metadata: { source: 'dashboard' } }),
        fakeLink({
          id: 'plink_a',
          // Payment Links have no `created`; the listing uses the line item's Price.created.
          line_items: {
            object: 'list',
            data: [{ description: 'S+ Dental — account balance', price: { created: 300 } }],
          } as never,
          metadata: {
            source: 'splus-admin',
            amount_display: '$10.00',
            patient_ref: 'AB-1',
            invoice: '',
            created_by: 'a@splus.dental',
            env: 'staging',
          },
        }),
        fakeLink({ id: 'plink_b', active: false }),
      ],
    });

    const res = await testApp(stripe).request('/api/payment-links?limit=1', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      links: [
        {
          id: 'plink_a',
          url: 'https://buy.stripe.com/test_abc',
          active: true,
          amountDisplay: '$10.00',
          description: 'S+ Dental — account balance',
          metadata: {
            source: 'splus-admin',
            amount_display: '$10.00',
            patient_ref: 'AB-1',
            invoice: '',
            created_by: 'a@splus.dental',
            env: 'staging',
          },
          created: 300,
        },
      ],
    });
    expect(stripe.paymentLinks.list).toHaveBeenCalledWith({
      limit: 100,
      expand: ['data.line_items'],
    });
  });

  it('400 for an out-of-range limit', async () => {
    const res = await testApp().request('/api/payment-links?limit=0', { headers: authHeaders() });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/payment-links/:id/deactivate', () => {
  const deactivate = (stripe: ReturnType<typeof fakeStripe>, id = 'plink_1') =>
    testApp(stripe).request(`/api/payment-links/${id}/deactivate`, {
      method: 'POST',
      headers: authHeaders(),
    });

  it('deactivates an admin-created link and logs the staff email', async () => {
    const stripe = fakeStripe();
    const res = await deactivate(stripe);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'plink_1', active: false });
    expect(stripe.paymentLinks.update).toHaveBeenCalledWith('plink_1', { active: false });
    expect(lines.join('\n')).toContain('frontdesk@splus.dental');
  });

  it('404 for links not created by the admin tool', async () => {
    const stripe = fakeStripe();
    stripe.paymentLinks.retrieve.mockResolvedValueOnce(fakeLink({ metadata: { source: 'other' } }));
    expect((await deactivate(stripe)).status).toBe(404);
    expect(stripe.paymentLinks.update).not.toHaveBeenCalled();
  });

  it('404 when Stripe does not know the link', async () => {
    const stripe = fakeStripe();
    stripe.paymentLinks.retrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        type: 'invalid_request_error',
        message: 'No such payment link',
        statusCode: 404,
      } as never),
    );
    expect((await deactivate(stripe)).status).toBe(404);
  });

  it('400 for a malformed id', async () => {
    const stripe = fakeStripe();
    expect((await deactivate(stripe, 'price_123')).status).toBe(400);
    expect(stripe.paymentLinks.retrieve).not.toHaveBeenCalled();
  });
});

describe('holds and Checkout branding', () => {
  it('holdForApproval: manual capture, hold metadata, and an explanation under the Pay button', async () => {
    const stripe = fakeStripe();
    const res = await post(stripe, {
      amountType: 'fixed',
      amountCents: 5000,
      holdForApproval: true,
    });
    expect(res.status).toBe(201);
    const params = firstArg(stripe.paymentLinks.create);
    expect(params.payment_intent_data.capture_method).toBe('manual');
    expect(params.payment_intent_data.metadata.hold).toBe('1');
    expect(params.metadata.hold).toBe('1');
    expect(params.custom_text.submit.message).toBe(
      'Questions about your balance? Call S+ Dental at (425) 616-2331. Your card will be authorized now and charged after our office confirms the amount.',
    );
  });

  it('without a hold: automatic capture (no capture_method) and no hold metadata', async () => {
    const stripe = fakeStripe();
    await post(stripe, { amountType: 'fixed', amountCents: 5000, holdForApproval: false });
    const params = firstArg(stripe.paymentLinks.create);
    expect(params.payment_intent_data.capture_method).toBeUndefined();
    expect(params.metadata.hold).toBeUndefined();
  });

  it('never attaches a product image (the account icon already shows the logo)', async () => {
    const stripe = fakeStripe();
    await post(stripe, { amountType: 'fixed', amountCents: 5000 });
    expect(firstArg(stripe.products.create)).not.toHaveProperty('images');
  });
});

describe('emailing links', () => {
  it('create with emailTo sends one email, records time/count only, and never stores the address', async () => {
    const stripe = fakeStripe();
    const email = fakeEmail();
    const res = await post(
      stripe,
      { amountType: 'fixed', amountCents: 35000, emailTo: 'pat@example.com' },
      IDEM,
      { email },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 'plink_1', emailed: true });
    expect(email.send).toHaveBeenCalledTimes(1);
    const msg = (email.send.mock.calls[0] as unknown[])[0] as Record<string, string>;
    expect(msg.to).toBe('pat@example.com');
    expect(msg.subject).toBe('[TEST] Your S+ Dental payment link');
    expect(msg.text).toContain('https://buy.stripe.com/test_abc');
    expect(stripe.paymentLinks.update).toHaveBeenCalledWith('plink_1', {
      metadata: { last_emailed_at: '1700000000', emailed_count: '1' },
    });
    const all = JSON.stringify([
      stripe.prices.create.mock.calls,
      stripe.paymentLinks.create.mock.calls,
      stripe.paymentLinks.update.mock.calls,
      lines,
    ]);
    expect(all).not.toContain('pat@example.com');
  });

  it('still returns the link when sending fails', async () => {
    const stripe = fakeStripe();
    const email = { send: vi.fn(async () => Promise.reject(new Error('boom'))) };
    const res = await post(
      stripe,
      { amountType: 'fixed', amountCents: 35000, emailTo: 'pat@example.com' },
      IDEM,
      { email },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: 'plink_1',
      emailed: false,
      emailError: 'send_failed',
    });
    expect(lines.join('\n')).not.toContain('pat@example.com');
  });

  it('reports email_disabled on create when email is off', async () => {
    const res = await post(fakeStripe(), {
      amountType: 'fixed',
      amountCents: 35000,
      emailTo: 'pat@example.com',
    });
    expect(await res.json()).toMatchObject({ emailed: false, emailError: 'email_disabled' });
  });

  it('rejects an invalid emailTo', async () => {
    const res = await post(fakeStripe(), {
      amountType: 'fixed',
      amountCents: 35000,
      emailTo: 'a@b.com, c@d.com',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request', fields: ['emailTo'] });
  });

  const sendEmail = (
    stripe: ReturnType<typeof fakeStripe>,
    to: unknown,
    extra: Parameters<typeof testApp>[2],
    id = 'plink_1',
  ) =>
    testApp(stripe, undefined, extra).request(`/api/payment-links/${id}/email`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ to }),
    });

  it('POST /:id/email sends for an active link of ours and increments the count', async () => {
    const stripe = fakeStripe();
    stripe.paymentLinks.retrieve.mockResolvedValueOnce(
      fakeLink({
        metadata: { source: 'splus-admin', amount_display: '$350.00', emailed_count: '2' },
      }),
    );
    const email = fakeEmail();
    const res = await sendEmail(stripe, 'pat@example.com', { email });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    const msg = (email.send.mock.calls[0] as unknown[])[0] as Record<string, string>;
    expect(msg.text).toContain('Amount: $350.00');
    expect(stripe.paymentLinks.update).toHaveBeenCalledWith('plink_1', {
      metadata: { last_emailed_at: '1700000000', emailed_count: '3' },
    });
    expect(lines.join('\n')).toContain('payment_link.emailed');
    expect(lines.join('\n')).not.toContain('pat@example.com');
  });

  it('POST /:id/email: 503 when off, 400 bad address, 404 not ours, 409 inactive, 429 rate limit, 502 send failure', async () => {
    expect((await sendEmail(fakeStripe(), 'pat@example.com', {})).status).toBe(503);
    expect((await sendEmail(fakeStripe(), 'nope', { email: fakeEmail() })).status).toBe(400);

    const foreign = fakeStripe();
    foreign.paymentLinks.retrieve.mockResolvedValueOnce(fakeLink({ metadata: {} }));
    expect((await sendEmail(foreign, 'pat@example.com', { email: fakeEmail() })).status).toBe(404);

    const inactive = fakeStripe();
    inactive.paymentLinks.retrieve.mockResolvedValueOnce(fakeLink({ active: false }));
    expect((await sendEmail(inactive, 'pat@example.com', { email: fakeEmail() })).status).toBe(409);

    const limiter = new SendRateLimiter(1, 3_600_000, () => 0);
    const email = fakeEmail();
    expect(
      (await sendEmail(fakeStripe(), 'pat@example.com', { email, emailLimiter: limiter })).status,
    ).toBe(200);
    expect(
      (await sendEmail(fakeStripe(), 'pat@example.com', { email, emailLimiter: limiter })).status,
    ).toBe(429);

    const failing = { send: vi.fn(async () => Promise.reject(new Error('x'))) };
    expect((await sendEmail(fakeStripe(), 'pat@example.com', { email: failing })).status).toBe(502);
  });
});
