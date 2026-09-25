import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type pg from 'pg';
import type { Principal, Scope } from './tokens.js';

// OWASP-recommended argon2id floor: 19 MiB memory, 2 iterations. Memory-hard hashing makes
// offline brute force of a leaked secret_hash column expensive on GPUs/ASICs.
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export interface ClientStore {
  create(name: string, scopes: Scope[]): Promise<{ clientId: string; clientSecret: string }>;
  authenticate(clientId: string, clientSecret: string): Promise<Principal | null>;
}

// Note: runs as the connecting (owner) role, not under tenant RLS: authentication happens
// before we know the tenant, and rag_app deliberately has no access to this table.
export function createClientStore(pool: pg.Pool): ClientStore {
  // Verified against when the client_id doesn't exist, so "unknown client" and "wrong secret"
  // take the same time. Otherwise response timing reveals which client_ids are real.
  const dummyHash = hash(randomBytes(32).toString('base64url'), ARGON2);

  return {
    async create(name, scopes) {
      const clientId = `rag_${randomBytes(9).toString('base64url')}`;
      const clientSecret = randomBytes(32).toString('base64url'); // 256 bits of entropy
      await pool.query(`INSERT INTO clients (client_id, secret_hash, name, scopes) VALUES ($1, $2, $3, $4)`, [
        clientId,
        await hash(clientSecret, ARGON2),
        name,
        scopes,
      ]);
      return { clientId, clientSecret }; // the secret is shown once and never stored in plaintext
    },

    async authenticate(clientId, clientSecret) {
      const { rows } = await pool.query<{ id: string; secret_hash: string; scopes: Scope[] }>(
        `SELECT id, secret_hash, scopes FROM clients WHERE client_id = $1`,
        [clientId],
      );
      const row = rows[0];
      // argon2 verify is constant-time in the comparison itself.
      const ok = await verify(row?.secret_hash ?? (await dummyHash), clientSecret);
      return row && ok ? { clientId: row.id, publicClientId: clientId, scopes: row.scopes } : null;
    },
  };
}
