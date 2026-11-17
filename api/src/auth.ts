import type { MiddlewareHandler } from 'hono';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

export interface Staff {
  email: string;
  name: string;
}

export type StaffEnv = { Variables: { staff: Staff } };

/** Verifies a Google ID token (signature, audience, issuer, expiry) and returns its claims; throws if invalid. */
export type TokenVerifier = (idToken: string) => Promise<TokenPayload>;

export function createGoogleVerifier(
  clientId: string,
  client: OAuth2Client = new OAuth2Client(),
): TokenVerifier {
  return async (idToken) => {
    if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured');
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('empty token payload');
    return payload;
  };
}

export function requireStaff(opts: {
  verify: TokenVerifier;
  adminHd: string;
}): MiddlewareHandler<StaffEnv> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
    if (!match?.[1]) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ error: 'unauthenticated' }, 401);
    }
    let claims: TokenPayload;
    try {
      claims = await opts.verify(match[1]);
    } catch {
      c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      return c.json({ error: 'invalid_token' }, 401);
    }
    // `hd` is only present for Google Workspace accounts; the email suffix alone is not proof.
    if (claims.email_verified !== true || claims.hd !== opts.adminHd || !claims.email) {
      return c.json({ error: 'forbidden' }, 403);
    }
    c.set('staff', { email: claims.email, name: claims.name ?? claims.email });
    await next();
  };
}
