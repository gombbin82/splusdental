import Stripe from 'stripe';
import { z } from 'zod';
import type { AppEnv } from './config.js';
import { PRACTICE, emailTo } from './email.js';

/** The subset of the Stripe SDK we use, so tests can inject a fake. */
export type StripeClient = {
  prices: Pick<Stripe['prices'], 'create'>;
  paymentLinks: Pick<Stripe['paymentLinks'], 'create' | 'list' | 'retrieve' | 'update'>;
  paymentIntents: Pick<Stripe['paymentIntents'], 'list' | 'retrieve' | 'capture' | 'cancel'>;
};

export const SOURCE = 'splus-admin';
export const DEFAULT_DESCRIPTION = 'S+ Dental — account balance';
export const MIN_CENTS = 50; // Stripe's USD minimum charge
export const MAX_CENTS = 1_000_000; // $10,000 sanity cap

const cents = z.number().int().min(MIN_CENTS).max(MAX_CENTS);
/** Form fields left blank arrive as "" — treat them as absent. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

export const createInput = z
  .strictObject({
    amountType: z.enum(['fixed', 'customer']),
    amountCents: optional(cents),
    presetCents: optional(cents),
    minimumCents: optional(cents),
    maximumCents: optional(cents),
    // Shown to the patient on Stripe. Generic only — the UI warns against health details.
    description: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^\p{Cc}]+$/u, 'no control characters')
      .default(DEFAULT_DESCRIPTION),
    // Internal references. Restricted charset/length keeps them to chart #s, initials, invoice #s.
    patientRef: optional(z.string().regex(/^[A-Za-z0-9#.-]{1,20}$/, 'chart # or initials only')),
    invoice: optional(z.string().regex(/^[A-Za-z0-9#./-]{1,40}$/, 'invoice number only')),
    singleUse: z.boolean().default(true),
    collectPhone: z.boolean().default(false),
    askPatientName: z.boolean().default(false),
    // Manual capture: the card is authorized at checkout and charged only after staff approve.
    holdForApproval: z.boolean().default(false),
    // Optional: email the new link to this address (never stored or logged).
    emailTo: optional(emailTo),
  })
  .superRefine((v, ctx) => {
    if (v.amountType === 'fixed') {
      if (v.amountCents === undefined) {
        ctx.addIssue({ code: 'custom', path: ['amountCents'], message: 'required' });
      }
      return;
    }
    const { presetCents: preset, minimumCents: min, maximumCents: max } = v;
    if (min !== undefined && max !== undefined && max < min) {
      ctx.addIssue({ code: 'custom', path: ['maximumCents'], message: 'below minimum' });
    }
    if (preset !== undefined && min !== undefined && preset < min) {
      ctx.addIssue({ code: 'custom', path: ['presetCents'], message: 'below minimum' });
    }
    if (preset !== undefined && max !== undefined && preset > max) {
      ctx.addIssue({ code: 'custom', path: ['presetCents'], message: 'above maximum' });
    }
  });

export type CreateInput = z.infer<typeof createInput>;

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const LINK_ID = /^plink_[A-Za-z0-9]{1,200}$/;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatCents = (c: number) => usd.format(c / 100);

export interface CreateContext {
  staffEmail: string;
  env: AppEnv;
  publicSiteUrl: string;
  idempotencyKey: string;
}

export async function createPaymentLink(
  stripe: StripeClient,
  input: CreateInput,
  ctx: CreateContext,
) {
  const amountDisplay =
    input.amountType === 'fixed' ? formatCents(input.amountCents!) : 'Patient enters amount';

  const metadata: Record<string, string> = {
    source: SOURCE,
    ...(input.holdForApproval ? { hold: '1' } : {}),
    ...(input.patientRef ? { patient_ref: input.patientRef } : {}),
    ...(input.invoice ? { invoice: input.invoice } : {}),
    created_by: ctx.staffEmail,
    amount_display: amountDisplay,
    env: ctx.env,
  };

  const amount: Pick<Stripe.PriceCreateParams, 'unit_amount' | 'custom_unit_amount'> =
    input.amountType === 'fixed'
      ? { unit_amount: input.amountCents! }
      : {
          custom_unit_amount: {
            enabled: true,
            ...(input.presetCents !== undefined ? { preset: input.presetCents } : {}),
            ...(input.minimumCents !== undefined ? { minimum: input.minimumCents } : {}),
            ...(input.maximumCents !== undefined ? { maximum: input.maximumCents } : {}),
          },
        };

  const price = await stripe.prices.create(
    {
      currency: 'usd',
      ...amount,
      product_data: {
        name: input.description,
        // Logo next to the line item on Checkout. Stripe needs a public https URL (not localhost).
        ...(ctx.publicSiteUrl.startsWith('https://')
          ? { images: [`${ctx.publicSiteUrl}/logo.png`] }
          : {}),
        metadata,
      },
      metadata,
    },
    { idempotencyKey: `${ctx.idempotencyKey}:price` },
  );

  const params: Stripe.PaymentLinkCreateParams = {
    line_items: [{ price: price.id, quantity: 1 }],
    after_completion: {
      type: 'redirect',
      redirect: { url: `${ctx.publicSiteUrl}/thank-you` },
    },
    ...(input.singleUse ? { restrictions: { completed_sessions: { limit: 1 } } } : {}),
    phone_number_collection: { enabled: input.collectPhone },
    ...(input.askPatientName
      ? {
          custom_fields: [
            {
              key: 'patientname',
              label: { type: 'custom', custom: 'Patient name' },
              type: 'text',
              optional: false,
            },
          ],
        }
      : {}),
    custom_text: { submit: { message: checkoutMessage(input.holdForApproval) } },
    metadata,
    payment_intent_data: input.holdForApproval
      ? { capture_method: 'manual', metadata }
      : { metadata },
  };
  const link = await stripe.paymentLinks.create(params, {
    idempotencyKey: `${ctx.idempotencyKey}:link`,
  });

  return { id: link.id, url: link.url, active: link.active, amountDisplay };
}

/** Shown under the Pay button on Stripe Checkout. Generic, no patient details. */
export function checkoutMessage(hold: boolean) {
  const base = `Questions about your balance? Call ${PRACTICE.name} at ${PRACTICE.phone}.`;
  return hold
    ? `${base} Your card will be authorized now and charged after our office confirms the amount.`
    : base;
}

export async function listPaymentLinks(stripe: StripeClient, limit: number) {
  // Stripe can't filter payment links by metadata server-side; fetch a page (newest first) and
  // filter here. Payment Links have no `created`, so use the Price we created just before the link.
  const page = await stripe.paymentLinks.list({ limit: 100, expand: ['data.line_items'] });
  return page.data
    .filter((l) => l.metadata?.source === SOURCE)
    .slice(0, limit)
    .map((l) => {
      const item = l.line_items?.data[0];
      return {
        id: l.id,
        url: l.url,
        active: l.active,
        amountDisplay: l.metadata?.amount_display ?? '',
        description: item?.description ?? null,
        metadata: l.metadata,
        created: item?.price?.created ?? null,
      };
    });
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Retrieve a link we created (404 otherwise) — for actions on a single link. */
export async function getOwnLink(stripe: StripeClient, id: string) {
  const link = await stripe.paymentLinks.retrieve(id);
  if (link.metadata?.source !== SOURCE) throw new NotFoundError();
  return link;
}

/** Record that a link was emailed: time and count only, never the address. */
export async function markEmailed(stripe: StripeClient, link: Stripe.PaymentLink, at: number) {
  const count = Number(link.metadata?.emailed_count ?? '0') || 0;
  await stripe.paymentLinks.update(link.id, {
    metadata: { last_emailed_at: String(at), emailed_count: String(count + 1) },
  });
}

export async function deactivatePaymentLink(stripe: StripeClient, id: string) {
  const link = await stripe.paymentLinks.retrieve(id);
  if (link.metadata?.source !== SOURCE) throw new NotFoundError();
  const updated = await stripe.paymentLinks.update(id, { active: false });
  return { id: updated.id, active: updated.active };
}

/** Map an error from the Stripe SDK to a client-safe status + code. Never echoes Stripe's message. */
export function stripeErrorResponse(err: unknown): {
  status: 400 | 404 | 409 | 502;
  error: string;
} {
  if (err instanceof NotFoundError) return { status: 404, error: 'not_found' };
  if (err instanceof ConflictError) return { status: 409, error: err.code };
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    return err.statusCode === 404
      ? { status: 404, error: 'not_found' }
      : { status: 400, error: 'stripe_rejected' };
  }
  if (err instanceof Stripe.errors.StripeIdempotencyError) {
    return { status: 400, error: 'stripe_rejected' };
  }
  return { status: 502, error: 'stripe_unavailable' };
}
