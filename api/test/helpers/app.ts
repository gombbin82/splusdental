import type Stripe from 'stripe';
import { vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { TokenVerifier } from '../../src/auth.js';
import type { Config } from '../../src/config.js';
import type { StripeClient } from '../../src/payment-links.js';

export const TEST_CONFIG: Config = {
  appEnv: 'staging',
  adminHd: 'splus.dental',
  googleClientId: 'test-client.apps.googleusercontent.com',
  publicSiteUrl: 'https://staging.splus.dental',
  stripeSecretKey: 'sk_test_dummy',
  port: 8080,
};

export const STAFF_TOKEN = 'good-token';

/** Token verification is covered with real signatures in auth.test.ts; here any non-good token is invalid. */
export const fakeVerifier: TokenVerifier = async (token) => {
  if (token !== STAFF_TOKEN) throw new Error('invalid');
  return {
    iss: 'https://accounts.google.com',
    aud: TEST_CONFIG.googleClientId,
    sub: '1',
    iat: 0,
    exp: 0,
    email: 'frontdesk@splus.dental',
    email_verified: true,
    hd: 'splus.dental',
    name: 'Front Desk',
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
  };
}

export function testApp(
  stripe: ReturnType<typeof fakeStripe> = fakeStripe(),
  config = TEST_CONFIG,
) {
  return createApp({ config, verify: fakeVerifier, stripe: stripe as unknown as StripeClient });
}

export const authHeaders = (extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${STAFF_TOKEN}`,
  ...extra,
});
