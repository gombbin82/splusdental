import type { MiddlewareHandler } from 'hono';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

export type Role = 'admin' | 'staff';

export interface Staff {
  email: string;
  name: string;
  role: Role;
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

/** Admins win if an email is on both lists. Emails are compared lower-cased. */
export function roleFor(
  email: string,
  lists: { adminEmails: readonly string[]; staffEmails: readonly string[] },
): Role | null {
  const e = email.trim().toLowerCase();
  if (lists.adminEmails.includes(e)) return 'admin';
  if (lists.staffEmails.includes(e)) return 'staff';
  return null;
}

/**
 * Signed-in users must present a valid Google ID token with a verified email that is on the admin
 * or staff allowlist. Anyone else is 403. Empty lists mean nobody gets in (fail closed).
 */
export function requireStaff(opts: {
  verify: TokenVerifier;
  adminEmails: readonly string[];
  staffEmails: readonly string[];
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
    if (claims.email_verified !== true || !claims.email) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const role = roleFor(claims.email, opts);
    if (!role) return c.json({ error: 'forbidden' }, 403);
    c.set('staff', { email: claims.email.toLowerCase(), name: claims.name ?? claims.email, role });
    await next();
  };
}

/** Use after requireStaff: only admins pass. */
export const requireAdmin: MiddlewareHandler<StaffEnv> = async (c, next) => {
  if (c.get('staff')?.role !== 'admin') return c.json({ error: 'admin_only' }, 403);
  await next();
};
