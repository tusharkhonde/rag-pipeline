import { vi } from 'vitest';
import type { ClientStore } from '../../src/auth/clients.js';
import { InvalidTokenError, SCOPES, type Principal, type Scope, type TokenService } from '../../src/auth/tokens.js';

export const TOKEN = 'good-token';

/** Token service that accepts exactly one bearer token, mapping it to `principal`. */
export function fakeAuth(clientId: string, scopes: Scope[] = [...SCOPES]): { tokens: TokenService; clients: ClientStore } {
  const principal: Principal = { clientId, publicClientId: 'rag_test', scopes };
  return {
    tokens: {
      issue: vi.fn(),
      jwks: () => ({ keys: [] }),
      verify: async (token) => {
        if (token !== TOKEN) throw new InvalidTokenError('bad token');
        return principal;
      },
    },
    clients: { create: vi.fn(), authenticate: vi.fn() },
  };
}

export const auth = { authorization: `Bearer ${TOKEN}` };
