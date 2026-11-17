import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLogSink, type LogSink } from '../src/log.js';
import { authHeaders, fakePaymentIntent, fakeStripe, testApp } from './helpers/app.js';

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

const list = (data: ReturnType<typeof fakePaymentIntent>[]) => ({
  object: 'list' as const,
  data,
  has_more: false,
});

describe('GET /api/payments', () => {
  it('401 without a token', async () => {
    expect((await testApp().request('/api/payments')).status).toBe(401);
  });

  it('held: only our requires_capture intents, with payer, card and capture deadline', async () => {
    const stripe = fakeStripe();
    stripe.paymentIntents.list.mockResolvedValueOnce(
      list([
        fakePaymentIntent(),
        fakePaymentIntent({ id: 'pi_2', status: 'succeeded' }),
        fakePaymentIntent({ id: 'pi_3', metadata: { source: 'other' } }),
      ]),
    );
    const res = await testApp(stripe).request('/api/payments?status=held', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(stripe.paymentIntents.list).toHaveBeenCalledWith({
      limit: 100,
      expand: ['data.latest_charge'],
    });
    expect(await res.json()).toEqual({
      payments: [
        {
          id: 'pi_1',
          status: 'held',
          amountDisplay: '$350.00',
          amountCents: 35000,
          created: 1_700_000_000,
          captureBefore: 1_700_600_000,
          patientRef: 'K1042',
          invoice: '2026-1',
          linkCreatedBy: null,
          payerName: 'Pat Payer',
          payerEmail: 'pat@example.com',
          card: { brand: 'visa', last4: '4242' },
        },
      ],
    });
    expect(lines.join('\n')).not.toContain('pat@example.com');
  });

  it('recent: all statuses mapped; incomplete checkouts hidden; capture deadline falls back to +7d', async () => {
    const stripe = fakeStripe();
    stripe.paymentIntents.list.mockResolvedValueOnce(
      list([
        fakePaymentIntent({ id: 'pi_a', latest_charge: null }),
        fakePaymentIntent({ id: 'pi_b', status: 'succeeded', amount_received: 35000 }),
        fakePaymentIntent({ id: 'pi_c', status: 'canceled' }),
        fakePaymentIntent({
          id: 'pi_d',
          status: 'requires_payment_method',
          last_payment_error: { type: 'card_error' } as never,
        }),
        fakePaymentIntent({ id: 'pi_e', status: 'requires_payment_method' }),
      ]),
    );
    const res = await testApp(stripe).request('/api/payments?status=recent', {
      headers: authHeaders(),
    });
    const { payments } = (await res.json()) as { payments: Record<string, unknown>[] };
    expect(payments.map((p) => [p.id, p.status])).toEqual([
      ['pi_a', 'held'],
      ['pi_b', 'paid'],
      ['pi_c', 'released'],
      ['pi_d', 'failed'],
    ]);
    expect(payments[0]!.captureBefore).toBe(1_700_000_000 + 7 * 24 * 3600);
    expect(payments[1]!.captureBefore).toBeNull();
  });

  it('400 for a bad status', async () => {
    const res = await testApp().request('/api/payments?status=all', { headers: authHeaders() });
    expect(res.status).toBe(400);
  });
});

describe('approve / release held payments', () => {
  const act = (
    stripe: ReturnType<typeof fakeStripe>,
    action: 'capture' | 'cancel',
    id = 'pi_1',
    idem: string | null = IDEM,
  ) =>
    testApp(stripe).request(`/api/payments/${id}/${action}`, {
      method: 'POST',
      headers: authHeaders(idem ? { 'Idempotency-Key': idem } : {}),
    });

  it('staff can approve: captures the full amount with an idempotency key', async () => {
    const stripe = fakeStripe();
    const res = await act(stripe, 'capture');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'pi_1',
      status: 'paid',
      amountDisplay: '$350.00',
    });
    expect(stripe.paymentIntents.capture).toHaveBeenCalledWith(
      'pi_1',
      { expand: ['latest_charge'] },
      { idempotencyKey: `${IDEM}:capture` },
    );
    expect(lines.join('\n')).toContain('payment.captured');
  });

  it('release cancels the authorization', async () => {
    const stripe = fakeStripe();
    const res = await act(stripe, 'cancel');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'released' });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(
      'pi_1',
      { cancellation_reason: 'requested_by_customer', expand: ['latest_charge'] },
      { idempotencyKey: `${IDEM}:cancel` },
    );
  });

  it('409 not_held when the payment is not awaiting approval', async () => {
    const stripe = fakeStripe();
    stripe.paymentIntents.retrieve.mockResolvedValueOnce(
      fakePaymentIntent({ status: 'succeeded' }),
    );
    const res = await act(stripe, 'capture');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_held' });
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });

  it('404 for a payment that is not from our links', async () => {
    const stripe = fakeStripe();
    stripe.paymentIntents.retrieve.mockResolvedValueOnce(fakePaymentIntent({ metadata: {} }));
    expect((await act(stripe, 'cancel')).status).toBe(404);
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
  });

  it('400 for a bad id or missing idempotency key; 401 without a token', async () => {
    expect((await act(fakeStripe(), 'capture', 'ch_1')).status).toBe(400);
    expect((await act(fakeStripe(), 'capture', 'pi_1', null)).status).toBe(400);
    const res = await testApp().request('/api/payments/pi_1/capture', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
