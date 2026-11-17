import type Stripe from 'stripe';
import { vi } from 'vitest';
import { createApp, type AppDeps } from '../../src/app.js';
import type { TokenVerifier } from '../../src/auth.js';
import type { Config } from '../../src/config.js';
import type { StripeClient } from '../../src/payment-links.js';

export const TEST_CONFIG: Config = {
  appEnv: 'staging',
  adminEmails: ['owner@splus.dental'],
  staffEmails: ['frontdesk@splus.dental'],
  googleClientId: 'test-client.apps.googleusercontent.com',
  publicSiteUrl: 'https://staging.splus.dental',
  stripeSecretKey: 'sk_test_dummy',
  gmailSender: 'info@splus.dental',
  runtimeSaEmail: '',
  port: 8080,
};

export const STAFF_TOKEN = 'good-token';
export const ADMIN_TOKEN = 'admin-token';

/** Token verification is covered with real signatures in auth.test.ts; here any non-good token is invalid. */
export const fakeVerifier: TokenVerifier = async (token) => {
  if (token !== STAFF_TOKEN && token !== ADMIN_TOKEN) throw new Error('invalid');
  const admin = token === ADMIN_TOKEN;
  return {
    iss: 'https://accounts.google.com',
    aud: TEST_CONFIG.googleClientId,
    sub: '1',
    iat: 0,
    exp: 0,
    email: admin ? 'owner@splus.dental' : 'frontdesk@splus.dental',
    email_verified: true,
    name: admin ? 'Owner' : 'Front Desk',
  };
};

export function fakeLink(overrides: Partial<Stripe.PaymentLink> = {}): Stripe.PaymentLink {
  return {
    id: 'plink_1',
    object: 'payment_link',
    url: 'https://buy.stripe.com/test_abc',
    active: true,
    metadata: { source: 'splus-admin', amount_display: '$350.00' },
    ...overrides,
  } as Stripe.PaymentLink;
}

export function fakeStripe() {
  return {
    products: {
      create: vi.fn(async () => ({ id: 'prod_1', object: 'product' }) as Stripe.Product),
    },
    prices: {
      create: vi.fn(async () => ({ id: 'price_1', object: 'price' }) as Stripe.Price),
    },
    paymentLinks: {
      create: vi.fn(async () => fakeLink()),
      list: vi.fn(async () => ({
        object: 'list',
        data: [] as Stripe.PaymentLink[],
        has_more: false,
      })),
      retrieve: vi.fn(async () => fakeLink()),
      update: vi.fn(async () => fakeLink({ active: false })),
    },
    paymentIntents: {
      list: vi.fn(async () => ({
        object: 'list',
        data: [] as Stripe.PaymentIntent[],
        has_more: false,
      })),
      retrieve: vi.fn(async () => fakePaymentIntent()),
      capture: vi.fn(async () =>
        fakePaymentIntent({ status: 'succeeded', amount_received: 35000 }),
      ),
      cancel: vi.fn(async () => fakePaymentIntent({ status: 'canceled' })),
    },
  };
}

export function fakePaymentIntent(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: 'pi_1',
    object: 'payment_intent',
    status: 'requires_capture',
    amount: 35000,
    amount_received: 0,
    created: 1_700_000_000,
    last_payment_error: null,
    metadata: { source: 'splus-admin', patient_ref: 'K1042', invoice: '2026-1', hold: '1' },
    latest_charge: {
      id: 'ch_1',
      object: 'charge',
      billing_details: { name: 'Pat Payer', email: 'pat@example.com' },
      payment_method_details: {
        type: 'card',
        card: { brand: 'visa', last4: '4242', capture_before: 1_700_600_000 },
      },
    },
    ...overrides,
  } as unknown as Stripe.PaymentIntent;
}

export function fakeEmail() {
  return { send: vi.fn(async () => undefined) };
}

export function testApp(
  stripe: ReturnType<typeof fakeStripe> = fakeStripe(),
  config = TEST_CONFIG,
  extra: Partial<Pick<AppDeps, 'email' | 'emailLimiter' | 'now'>> = {},
) {
  return createApp({
    config,
    verify: fakeVerifier,
    stripe: stripe as unknown as StripeClient,
    email: null,
    now: () => 1_700_000_000_000,
    ...extra,
  });
}

export const authHeaders = (extra: Record<string, string> = {}, token = STAFF_TOKEN) => ({
  Authorization: `Bearer ${token}`,
  ...extra,
});
