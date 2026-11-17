import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import Stripe from 'stripe';
import { requireStaff, type StaffEnv, type TokenVerifier } from './auth.js';
import { stripeMode, type Config } from './config.js';
import { log } from './log.js';
import {
  LINK_ID,
  createInput,
  createPaymentLink,
  deactivatePaymentLink,
  listPaymentLinks,
  listQuery,
  stripeErrorResponse,
  type StripeClient,
} from './payment-links.js';

export interface AppDeps {
  config: Config;
  verify: TokenVerifier;
  stripe: StripeClient;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

export function createApp({ config, verify, stripe }: AppDeps) {
  const app = new Hono<StaffEnv>().basePath('/api');

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
      adminHd: config.adminHd,
      stripeMode: stripeMode(config.stripeSecretKey),
      env: config.appEnv,
    }),
  );

  const staffOnly = requireStaff({ verify, adminHd: config.adminHd });
  app.use('/me', staffOnly);
  app.use('/payment-links', staffOnly);
  app.use('/payment-links/*', staffOnly);

  app.get('/me', (c) => c.json(c.get('staff')));

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
    });
    return c.json(link, 201);
  });

  app.post('/payment-links/:id/deactivate', async (c) => {
    const id = c.req.param('id');
    if (!LINK_ID.test(id)) return c.json({ error: 'invalid_request' }, 400);
    const result = await deactivatePaymentLink(stripe, id);
    log('INFO', 'payment_link.deactivated', { staff: c.get('staff').email, paymentLinkId: id });
    return c.json(result);
  });

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
