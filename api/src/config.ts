export type AppEnv = 'dev' | 'staging' | 'prod';
export type StripeMode = 'test' | 'live';

export interface Config {
  appEnv: AppEnv;
  /** Lower-cased allowlists (ADMIN_EMAILS / STAFF_EMAILS, comma or whitespace separated). */
  adminEmails: string[];
  staffEmails: string[];
  googleClientId: string;
  publicSiteUrl: string;
  stripeSecretKey: string;
  /** Mailbox payment-link emails are sent as (Gmail via domain-wide delegation). '' = email off. */
  gmailSender: string;
  /** Runtime service account email; discovered from the metadata server when unset. */
  runtimeSaEmail: string;
  port: number;
}

const APP_ENVS: readonly AppEnv[] = ['dev', 'staging', 'prod'];

/** Derive the Stripe mode from the key prefix. Anything unrecognised is reported as test. */
export function stripeMode(key: string | undefined): StripeMode {
  return /^(sk|rk)_live_/.test(key ?? '') ? 'live' : 'test';
}

/** Parse a comma/whitespace separated email list; lower-cased, de-duplicated. */
export function parseEmailList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(/[\s,]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const appEnv = (env.APP_ENV || 'dev') as AppEnv;
  if (!APP_ENVS.includes(appEnv)) {
    throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}`);
  }
  // Trim: keys pasted into Secret Manager often end with a newline, which Node refuses to send in
  // the Authorization header (Stripe reports it as a connection error).
  const stripeSecretKey = (env.STRIPE_SECRET_KEY ?? '').trim();
  if (appEnv !== 'prod' && stripeMode(stripeSecretKey) === 'live') {
    throw new Error('Refusing to use a live Stripe key outside prod');
  }
  return {
    appEnv,
    adminEmails: parseEmailList(env.ADMIN_EMAILS),
    staffEmails: parseEmailList(env.STAFF_EMAILS),
    googleClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    publicSiteUrl: (env.PUBLIC_SITE_URL || 'http://localhost:4321').replace(/\/+$/, ''),
    stripeSecretKey,
    gmailSender: (env.GMAIL_SENDER ?? '').trim().toLowerCase(),
    runtimeSaEmail: (env.RUNTIME_SA_EMAIL ?? '').trim(),
    port: Number(env.PORT || 8080),
  };
}
