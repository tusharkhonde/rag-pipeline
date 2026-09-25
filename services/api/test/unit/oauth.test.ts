import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { ClientStore } from '../../src/auth/clients.js';
import { loadSigningKey } from '../../src/auth/keys.js';
import { createTokenService, type TokenService } from '../../src/auth/tokens.js';
import { loadConfig } from '../../src/config.js';

const ID = 'rag_client';
const SECRET = 's3cret/with:odd+chars';
let tokens: TokenService;

beforeAll(async () => {
  tokens = createTokenService(await loadSigningKey(await mkdtemp(path.join(tmpdir(), 'rag-keys-'))), {
    issuer: 'rag-api', audience: 'rag-api', ttlSeconds: 900,
  });
});

function setup() {
  const clients: ClientStore = {
    create: vi.fn(),
    authenticate: vi.fn(async (id, secret) =>
      id === ID && secret === SECRET ? { clientId: 'tenant-1', publicClientId: ID, scopes: ['documents:write', 'query'] } : null),
  };
  const app = buildApp({
    config: loadConfig({ DATABASE_URL: 'postgres://unused', LOG_LEVEL: 'fatal' }),
    repo: { listCollections: vi.fn(async () => []) } as never,
    ml: {} as never, retriever: {} as never, answerer: {} as never,
    clients, tokens,
  });
  return { app, clients };
}

const form = (fields: Record<string, string>) => ({
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams(fields).toString(),
});
const basic = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

describe('POST /oauth/token (client credentials)', () => {
  it('issues a token with client_secret_basic, marked no-store, that works on the API', async () => {
    const { app } = setup();
    const f = form({ grant_type: 'client_credentials' });
    const res = await app.inject({ method: 'POST', url: '/oauth/token', ...f, headers: { ...f.headers, authorization: basic(ID, SECRET) } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'documents:write query' });

    const api = await app.inject({ method: 'GET', url: '/collections', headers: { authorization: `Bearer ${body.access_token}` } });
    expect(api.statusCode).toBe(200);
  });

  it('accepts client_secret_post (credentials in the form body)', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET }) });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong secret with invalid_client (401)', async () => {
    const { app } = setup();
    const f = form({ grant_type: 'client_credentials' });
    const res = await app.inject({ method: 'POST', url: '/oauth/token', ...f, headers: { ...f.headers, authorization: basic(ID, 'nope') } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_client');
    expect(res.headers['www-authenticate']).toBe('Basic realm="rag-api"');
  });

  it('rejects other grant types', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'password', client_id: ID, client_secret: SECRET }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unsupported_grant_type');
  });

  it('allows down-scoping but not escalation', async () => {
    const { app } = setup();
    const down = await app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET, scope: 'query' }) });
    expect(down.json().scope).toBe('query');
    const up = await app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET, scope: 'query admin' }) });
    expect(up.statusCode).toBe(400);
    expect(up.json().error).toBe('invalid_scope');
  });

  it('rate-limits the token endpoint', async () => {
    const { app } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'client_credentials', client_id: ID, client_secret: 'x' }) })).statusCode);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it('serves the JWKS publicly', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().keys[0].kty).toBe('RSA');
  });
});
