import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import Stripe from 'stripe';
import {
  AnalyticsError,
  TrafficCache,
  getTraffic,
  trafficQuery,
  type AnalyticsClient,
} from './analytics.js';
import { requireAdmin, requireStaff, type StaffEnv, type TokenVerifier } from './auth.js';
import { stripeMode, type Config } from './config.js';
import { SendRateLimiter, emailTo, paymentLinkEmail, type EmailSender } from './email.js';
import { log } from './log.js';
import {
  LINK_ID,
  createInput,
  createPaymentLink,
  deactivatePaymentLink,
  getOwnLink,
  listPaymentLinks,
  listQuery,
  markEmailed,
  stripeErrorResponse,
  type StripeClient,
} from './payment-links.js';
import {
  PAYMENT_ID,
  capturePayment,
  listPayments,
  paymentsQuery,
  releasePayment,
} from './payments.js';

export interface AppDeps {
  config: Config;
  verify: TokenVerifier;
  stripe: StripeClient;
  /** Null when GMAIL_SENDER is unset: email features are off. */
  email?: EmailSender | null;
  emailLimiter?: SendRateLimiter;
  /** Null when GA4_PROPERTY_ID is unset: the traffic page shows setup instructions. */
  analytics?: AnalyticsClient | null;
  now?: () => number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

export function createApp({
  config,
  verify,
  stripe,
  email = null,
  emailLimiter = new SendRateLimiter(),
  analytics = null,
  now = Date.now,
}: AppDeps) {
  const trafficCache = new TrafficCache();
  const app = new Hono<StaffEnv>().basePath('/api');

  /** Send a payment-link email; returns an error code instead of throwing. Never logs `to`. */
  const sendLinkEmail = async (
    staffEmail: string,
    to: string,
    link: { url: string; amountDisplay: string },
  ): Promise<'email_disabled' | 'rate_limited' | 'send_failed' | null> => {
    if (!email) return 'email_disabled';
    if (!emailLimiter.take(staffEmail)) return 'rate_limited';
    try {
      await email.send({ to, ...paymentLinkEmail({ ...link, env: config.appEnv }) });
      return null;
    } catch (err) {
      const e = err as { step?: string; status?: number };
      log('ERROR', 'email_failed', { staff: staffEmail, step: e.step, status: e.status });
      return 'send_failed';
    }
  };

  const idempotencyKeyOf = (header: string | undefined) => {
    const key = header ?? '';
    return UUID.test(key) ? key : null;
  };

  // Request log: method, path (no query string), status, latency. Never headers or bodies.
  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    log(c.res.status >= 500 ? 'ERROR' : 'INFO', 'request', {
      httpRequest: {
        requestMethod: c.req.method,
        requestUrl: c.req.path,
        status: c.res.status,
        latency: `${((performance.now() - start) / 1000).toFixed(3)}s`,
      },
    });
  });

  app.use(
    secureHeaders({
      xFrameOptions: 'DENY',
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );
  app.use(async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // The admin UI is same-origin (Firebase Hosting rewrite). No CORS: refuse preflights and
  // anything a browser marks as coming from another site.
  app.use(async (c, next) => {
    const site = c.req.header('Sec-Fetch-Site');
    if (c.req.method === 'OPTIONS' || (site && site !== 'same-origin' && site !== 'none')) {
      return c.json({ error: 'cross_origin_forbidden' }, 403);
    }
    await next();
  });

  app.use(
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'too_large' }, 413) }),
  );

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/config', (c) =>
    c.json({
      googleClientId: config.googleClientId,
      stripeMode: stripeMode(config.stripeSecretKey),
      env: config.appEnv,
      emailEnabled: email !== null,
    }),
  );

  const staffOnly = requireStaff({
    verify,
    adminEmails: config.adminEmails,
    staffEmails: config.staffEmails,
  });
  app.use('/me', staffOnly);
  app.use('/payment-links', staffOnly);
  app.use('/payment-links/*', staffOnly);
  app.use('/payments', staffOnly);
  app.use('/payments/*', staffOnly);
  app.use('/admin/*', staffOnly, requireAdmin);

  app.get('/me', (c) => c.json(c.get('staff')));

  // Admin-only. Read-only view of how this environment is configured (no secrets, no emails).
  app.get('/admin/settings', (c) =>
    c.json({
      env: config.appEnv,
      stripeMode: stripeMode(config.stripeSecretKey),
      publicSiteUrl: config.publicSiteUrl,
      adminCount: config.adminEmails.length,
      staffCount: config.staffEmails.length,
    }),
  );

  // Admin-only. Aggregate website traffic from GA4 (cached 10 minutes per range).
  app.get('/admin/traffic', async (c) => {
    if (!analytics) return c.json({ error: 'analytics_disabled' }, 503);
    const q = trafficQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'invalid_request' }, 400);
    try {
      const t = now();
      return c.json(
        await trafficCache.get(q.data.days, t, () => getTraffic(analytics, q.data.days, t)),
      );
    } catch (err) {
      const status = err instanceof AnalyticsError ? err.status : 0;
      log('ERROR', 'analytics_failed', { status });
      // 403: the runtime service account hasn't been added to the GA4 property yet.
      return c.json({ error: status === 403 ? 'analytics_forbidden' : 'analytics_failed' }, 502);
    }
  });

  app.get('/payment-links', async (c) => {
    const q = listQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ links: await listPaymentLinks(stripe, q.data.limit) });
  });

  app.post('/payment-links', async (c) => {
    const idempotencyKey = c.req.header('Idempotency-Key') ?? '';
    if (!UUID.test(idempotencyKey)) {
      return c.json({ error: 'invalid_request', fields: ['Idempotency-Key'] }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const parsed = createInput.safeParse(body);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(body)'))];
      return c.json({ error: 'invalid_request', fields }, 400);
    }
    const staff = c.get('staff');
    const link = await createPaymentLink(stripe, parsed.data, {
      staffEmail: staff.email,
      env: config.appEnv,
      publicSiteUrl: config.publicSiteUrl,
      idempotencyKey,
    });
    log('INFO', 'payment_link.created', {
      staff: staff.email,
      paymentLinkId: link.id,
      amountType: parsed.data.amountType,
      hold: parsed.data.holdForApproval,
    });
    if (!parsed.data.emailTo) return c.json(link, 201);

    const emailError = await sendLinkEmail(staff.email, parsed.data.emailTo, link);
    if (emailError) return c.json({ ...link, emailed: false, emailError }, 201);
    log('INFO', 'payment_link.emailed', { staff: staff.email, paymentLinkId: link.id });
    try {
      await markEmailed(stripe, await getOwnLink(stripe, link.id), Math.floor(now() / 1000));
    } catch {
      // Bookkeeping only; the email went out.
    }
    return c.json({ ...link, emailed: true }, 201);
  });

  app.post('/payment-links/:id/email', async (c) => {
    if (!email) return c.json({ error: 'email_disabled' }, 503);
    const id = c.req.param('id');
    if (!LINK_ID.test(id)) return c.json({ error: 'invalid_request' }, 400);
    let body: { to?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const to = emailTo.safeParse(body?.to);
    if (!to.success) return c.json({ error: 'invalid_request', fields: ['to'] }, 400);

    const link = await getOwnLink(stripe, id);
    if (!link.active) return c.json({ error: 'link_inactive' }, 409);
    const staff = c.get('staff');
    const err = await sendLinkEmail(staff.email, to.data, {
      url: link.url,
      amountDisplay: link.metadata?.amount_display ?? '',
    });
    if (err === 'rate_limited') return c.json({ error: 'rate_limited' }, 429);
    if (err) return c.json({ error: 'email_failed' }, 502);
    log('INFO', 'payment_link.emailed', { staff: staff.email, paymentLinkId: id });
    await markEmailed(stripe, link, Math.floor(now() / 1000));
    return c.json({ sent: true });
  });

  app.post('/payment-links/:id/deactivate', async (c) => {
    const id = c.req.param('id');
    if (!LINK_ID.test(id)) return c.json({ error: 'invalid_request' }, 400);
    const result = await deactivatePaymentLink(stripe, id);
    log('INFO', 'payment_link.deactivated', { staff: c.get('staff').email, paymentLinkId: id });
    return c.json(result);
  });

  app.get('/payments', async (c) => {
    const q = paymentsQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'invalid_request' }, 400);
    return c.json({ payments: await listPayments(stripe, q.data) });
  });

  for (const [action, fn, event] of [
    ['capture', capturePayment, 'payment.captured'],
    ['cancel', releasePayment, 'payment.released'],
  ] as const) {
    app.post(`/payments/:id/${action}`, async (c) => {
      const id = c.req.param('id');
      if (!PAYMENT_ID.test(id)) return c.json({ error: 'invalid_request' }, 400);
      const key = idempotencyKeyOf(c.req.header('Idempotency-Key'));
      if (!key) return c.json({ error: 'invalid_request', fields: ['Idempotency-Key'] }, 400);
      const payment = await fn(stripe, id, key);
      log('INFO', event, { staff: c.get('staff').email, paymentIntentId: id });
      return c.json(payment);
    });
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    const { status, error } = stripeErrorResponse(err);
    // Log only non-sensitive identifiers; Stripe messages can echo request params.
    const detail =
      err instanceof Stripe.errors.StripeError
        ? { type: err.type, code: err.code, statusCode: err.statusCode, requestId: err.requestId }
        : { name: err.name, stack: err.stack };
    log(status >= 500 ? 'ERROR' : 'WARNING', 'request_failed', { path: c.req.path, ...detail });
    return c.json({ error }, status);
  });

  return app;
}
