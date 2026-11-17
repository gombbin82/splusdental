// Payments made through our links, and approval of held (manual-capture) payments.
import type Stripe from 'stripe';
import { z } from 'zod';
import {
  ConflictError,
  NotFoundError,
  SOURCE,
  formatCents,
  type StripeClient,
} from './payment-links.js';

export const paymentsQuery = z.object({
  status: z.enum(['held', 'recent']).default('held'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const PAYMENT_ID = /^pi_[A-Za-z0-9]{1,200}$/;

/** Card authorizations expire after about 7 days if not captured. */
const DEFAULT_HOLD_SECONDS = 7 * 24 * 3600;

export type PaymentStatus = 'held' | 'paid' | 'released' | 'failed' | 'processing' | 'incomplete';

export function paymentStatus(pi: Stripe.PaymentIntent): PaymentStatus {
  switch (pi.status) {
    case 'requires_capture':
      return 'held';
    case 'succeeded':
      return 'paid';
    case 'canceled':
      return 'released';
    case 'processing':
      return 'processing';
    case 'requires_payment_method':
      return pi.last_payment_error ? 'failed' : 'incomplete';
    default:
      return 'incomplete';
  }
}

function charge(pi: Stripe.PaymentIntent): Stripe.Charge | null {
  return pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
}

/** Shape for the admin UI. Payer details are shown to staff but never logged. */
export function toPayment(pi: Stripe.PaymentIntent) {
  const ch = charge(pi);
  const card = ch?.payment_method_details?.card ?? null;
  const status = paymentStatus(pi);
  const amountCents = status === 'paid' ? pi.amount_received || pi.amount : pi.amount;
  return {
    id: pi.id,
    status,
    amountDisplay: formatCents(amountCents),
    amountCents,
    created: pi.created,
    captureBefore:
      status === 'held' ? (card?.capture_before ?? pi.created + DEFAULT_HOLD_SECONDS) : null,
    patientRef: pi.metadata?.patient_ref ?? null,
    invoice: pi.metadata?.invoice ?? null,
    linkCreatedBy: pi.metadata?.created_by ?? null,
    payerName: ch?.billing_details?.name ?? null,
    payerEmail: ch?.billing_details?.email ?? null,
    card: card ? { brand: card.brand ?? null, last4: card.last4 ?? null } : null,
  };
}

export async function listPayments(
  stripe: StripeClient,
  q: { status: 'held' | 'recent'; limit: number },
) {
  // List (not Search) so new payments show immediately; filter to our links here.
  const page = await stripe.paymentIntents.list({ limit: 100, expand: ['data.latest_charge'] });
  return page.data
    .filter((pi) => pi.metadata?.source === SOURCE)
    .filter((pi) => (q.status === 'held' ? pi.status === 'requires_capture' : true))
    .filter((pi) => q.status === 'held' || paymentStatus(pi) !== 'incomplete')
    .slice(0, q.limit)
    .map(toPayment);
}

async function getHeld(stripe: StripeClient, id: string) {
  const pi = await stripe.paymentIntents.retrieve(id);
  if (pi.metadata?.source !== SOURCE) throw new NotFoundError();
  if (pi.status !== 'requires_capture') throw new ConflictError('not_held');
  return pi;
}

/** Approve: charge the full held amount. */
export async function capturePayment(stripe: StripeClient, id: string, idempotencyKey: string) {
  await getHeld(stripe, id);
  const pi = await stripe.paymentIntents.capture(
    id,
    { expand: ['latest_charge'] },
    { idempotencyKey: `${idempotencyKey}:capture` },
  );
  return toPayment(pi);
}

/** Release: cancel the authorization; nothing is charged. */
export async function releasePayment(stripe: StripeClient, id: string, idempotencyKey: string) {
  await getHeld(stripe, id);
  const pi = await stripe.paymentIntents.cancel(
    id,
    { cancellation_reason: 'requested_by_customer', expand: ['latest_charge'] },
    { idempotencyKey: `${idempotencyKey}:cancel` },
  );
  return toPayment(pi);
}
