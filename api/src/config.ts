export type AppEnv = 'dev' | 'staging' | 'prod';
export type StripeMode = 'test' | 'live';

export interface Config {
  appEnv: AppEnv;
  adminHd: string;
  googleClientId: string;
  publicSiteUrl: string;
  stripeSecretKey: string;
  port: number;
}

const APP_ENVS: readonly AppEnv[] = ['dev', 'staging', 'prod'];

/** Derive the Stripe mode from the key prefix. Anything unrecognised is reported as test. */
export function stripeMode(key: string | undefined): StripeMode {
  return /^(sk|rk)_live_/.test(key ?? '') ? 'live' : 'test';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const appEnv = (env.APP_ENV || 'dev') as AppEnv;
  if (!APP_ENVS.includes(appEnv)) {
    throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}`);
  }
  const stripeSecretKey = env.STRIPE_SECRET_KEY ?? '';
  if (appEnv !== 'prod' && stripeMode(stripeSecretKey) === 'live') {
    throw new Error('Refusing to use a live Stripe key outside prod');
  }
  return {
    appEnv,
    adminHd: env.ADMIN_HD || 'splus.dental',
    googleClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    publicSiteUrl: (env.PUBLIC_SITE_URL || 'http://localhost:4321').replace(/\/+$/, ''),
    stripeSecretKey,
    port: Number(env.PORT || 8080),
  };
}
