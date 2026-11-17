import { serve } from '@hono/node-server';
import Stripe from 'stripe';
import { createApp } from './app.js';
import { createGoogleVerifier } from './auth.js';
import { loadConfig, stripeMode } from './config.js';
import { createDefaultGmailSender } from './email.js';
import { log } from './log.js';

const config = loadConfig();
if (!config.googleClientId)
  log('WARNING', 'GOOGLE_OAUTH_CLIENT_ID not set; admin sign-in disabled');
if (!config.stripeSecretKey) log('WARNING', 'STRIPE_SECRET_KEY not set; payment links will fail');
if (!config.gmailSender) log('INFO', 'GMAIL_SENDER not set; emailing links is disabled');

const app = createApp({
  config,
  verify: createGoogleVerifier(config.googleClientId),
  email: config.gmailSender
    ? createDefaultGmailSender(config.gmailSender, config.runtimeSaEmail)
    : null,
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

// Cloud Run sends SIGTERM before stopping an instance.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
