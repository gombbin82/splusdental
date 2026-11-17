import { createSign, generateKeyPairSync } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { vi } from 'vitest';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const KID = 'test-kid';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** A Google-style ID token signed with a local test key. */
export function signIdToken(
  claims: Record<string, unknown> = {},
  opts: { wrongKey?: boolean } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'staff@splus.dental',
    email_verified: true,
    hd: 'splus.dental',
    name: 'Test Staff',
    iat: now - 60,
    exp: now + 3600,
    ...claims,
  };
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256')
    .update(signed)
    .sign(opts.wrongKey ? otherKey : privateKey);
  return `${signed}.${b64url(sig)}`;
}

/** OAuth2Client that trusts the local test key instead of fetching Google's certs (no network). */
export function testOAuthClient(): OAuth2Client {
  const client = new OAuth2Client();
  vi.spyOn(client, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { [KID]: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    format: 'PEM' as never,
  });
  return client;
}
