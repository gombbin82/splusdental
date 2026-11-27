import { serve } from '@hono/node-server';
import Stripe from 'stripe';
import { createGa4Client } from './analytics.js';
import { createApp } from './app.js';
import { createGoogleVerifier } from './auth.js';
import { loadConfig, stripeMode } from './config.js';
import { openDb } from './db/index.js';
import { applySeed, parseSeed, readSeedFile } from './db/seed.js';
import { createDefaultGmailSender } from './email.js';
import { log } from './log.js';

const config = loadConfig();
if (!config.googleClientId)
  log('WARNING', 'GOOGLE_OAUTH_CLIENT_ID not set; admin sign-in disabled');
if (!config.stripeSecretKey) log('WARNING', 'STRIPE_SECRET_KEY not set; payment links will fail');
if (!config.gmailSender) log('INFO', 'GMAIL_SENDER not set; emailing links is disabled');
if (!config.ga4PropertyId) log('INFO', 'GA4_PROPERTY_ID not set; traffic reports are disabled');

const opened = await openDb({ databaseUrl: config.databaseUrl, appEnv: config.appEnv });
if (opened) log('INFO', 'database ready', { driver: opened.driver });
else log('INFO', 'DATABASE_URL not set; provider records are disabled');

// Practice records (providers, locations, payers) added if missing: SEED_JSON (staging/prod, from
// Secret Manager) or, in local dev, api/seed.local.json (git-ignored). Never patient data.
if (opened) {
  try {
    const seed = config.seedJson
      ? parseSeed(config.seedJson, 'SEED_JSON')
      : config.appEnv === 'dev'
        ? readSeedFile()
        : null;
    if (seed) log('INFO', 'seed applied', { added: await applySeed(opened.db, seed) });
  } catch (err) {
    log('WARNING', 'seed skipped', { reason: (err as Error).message });
  }
}

const app = createApp({
  config,
  db: opened?.db ?? null,
  verify: createGoogleVerifier(config.googleClientId),
  email: config.gmailSender
    ? createDefaultGmailSender(config.gmailSender, config.runtimeSaEmail)
    : null,
  analytics: config.ga4PropertyId ? createGa4Client(config.ga4PropertyId) : null,
  // A placeholder key keeps the SDK constructible; calls fail with an auth error (502) until set.
  stripe: new Stripe(config.stripeSecretKey || 'sk_test_unset', {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: 'splus-admin' },
  }),
});

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  log('INFO', 'api listening', {
    port: config.port,
    env: config.appEnv,
    stripeMode: stripeMode(config.stripeSecretKey),
  });
});

// Cloud Run sends SIGTERM before stopping an instance; `tsx watch` and Ctrl+C stop dev servers.
// Drop idle keep-alive connections so close() doesn't hang, then close the database (releases the
// local PGlite lock) and exit.
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    void (opened?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  });
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  // Don't wait forever on a long request.
  setTimeout(() => {
    void (opened?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  }, 5_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
