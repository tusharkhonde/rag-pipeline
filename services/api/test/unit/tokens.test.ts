import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SignJWT, UnsecuredJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSigningKey, type SigningKey } from '../../src/auth/keys.js';
import { createTokenService, InvalidTokenError, type Principal } from '../../src/auth/tokens.js';

const principal: Principal = { clientId: '0b9f1c2e-0000-4000-8000-000000000001', publicClientId: 'rag_abc', scopes: ['query'] };
const opts = { issuer: 'rag-api', audience: 'rag-api', ttlSeconds: 900 };
let key: SigningKey;
let keysDir: string;

beforeAll(async () => {
  keysDir = await mkdtemp(path.join(tmpdir(), 'rag-keys-'));
  key = await loadSigningKey(keysDir);
});

/** Hand-craft a token so we can test what verify() rejects. `claims` override the valid defaults. */
const craft = (claims: Record<string, unknown> = {}, signer = key.privateKey, header: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    scope: 'query', client_id: 'rag_abc', iss: 'rag-api', aud: 'rag-api', sub: principal.clientId,
    iat: now, exp: now + 900, jti: 'j1', ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'at+jwt', ...header })
    .sign(signer);
};

describe('token service', () => {
  it('issues a token that verifies back to the same principal', async () => {
    const tokens = createTokenService(key, opts);
    const issued = await tokens.issue(principal);
    expect(issued).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'query' });
    await expect(tokens.verify(issued.access_token)).resolves.toEqual(principal);
  });

  it('publishes the public key (only) in the JWKS, identified by kid', () => {
    const [jwk] = createTokenService(key, opts).jwks().keys;
    expect(jwk).toMatchObject({ kty: 'RSA', kid: key.kid, alg: 'RS256', use: 'sig' });
    expect(jwk).not.toHaveProperty('d'); // private exponent must never be published
  });

  it('reuses the persisted key across restarts', async () => {
    expect((await loadSigningKey(keysDir)).kid).toBe(key.kid);
  });

  const rejects = (name: string, token: () => Promise<string>, tokenOpts = opts) =>
    it(`rejects ${name}`, async () => {
      await expect(createTokenService(key, tokenOpts).verify(await token())).rejects.toBeInstanceOf(InvalidTokenError);
    });

  rejects('an expired token', () => craft({ exp: Math.floor(Date.now() / 1000) - 120 }));
  rejects('a token for another audience', () => craft({ aud: 'some-other-api' }));
  rejects('a token from another issuer', () => craft({ iss: 'evil' }));
  rejects('a token signed by a different key', () =>
    craft({}, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey));
  rejects('an unsigned alg=none token', async () =>
    new UnsecuredJWT({ scope: 'documents:write query' }).setSubject(principal.clientId).setIssuer('rag-api').setAudience('rag-api').encode());
  rejects('an HS256 token "signed" with the public key (algorithm confusion)', () =>
    new SignJWT({ scope: 'query' })
      .setProtectedHeader({ alg: 'HS256', kid: key.kid, typ: 'at+jwt' })
      .setIssuer('rag-api').setAudience('rag-api').setSubject(principal.clientId).setIssuedAt().setExpirationTime('15m').setJti('j')
      .sign(new TextEncoder().encode(JSON.stringify(key.publicJwk))));
  rejects('a token with a tampered payload', async () => {
    const [h, , s] = (await craft()).split('.');
    const payload = Buffer.from(JSON.stringify({ sub: 'someone-else', scope: 'documents:write query' })).toString('base64url');
    return `${h}.${payload}.${s}`;
  });

  it('drops unknown scopes from the token', async () => {
    const principalOut = await createTokenService(key, opts).verify(await craft({ scope: 'query admin' }));
    expect(principalOut.scopes).toEqual(['query']);
  });
});
