import type pg from 'pg';

export interface Collection {
  id: string;
  name: string;
  version: number;
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  chunkCount: number;
  createdAt: string;
}

// Every method takes the tenant (clientId) and filters by it in SQL. A collection owned by
// another client is indistinguishable from one that doesn't exist: callers get null → 404.
export interface Repo {
  createCollection(clientId: string, name: string): Promise<Collection | null>;
  listCollections(clientId: string): Promise<Collection[]>;
  getCollection(clientId: string, collectionId: string): Promise<Collection | null>;
  listDocuments(clientId: string, collectionId: string): Promise<DocumentSummary[]>;
}

const COLLECTION_COLUMNS = `id, name, version, created_at AS "createdAt"`;

export function createRepo(pool: pg.Pool): Repo {
  return {
    async createCollection(clientId, name) {
      const { rows } = await pool.query<Collection>(
        `INSERT INTO collections (client_id, name) VALUES ($1, $2)
         ON CONFLICT (client_id, name) DO NOTHING
         RETURNING ${COLLECTION_COLUMNS}`,
        [clientId, name],
      );
      return rows[0] ?? null; // null = name already taken by this client
    },

    async listCollections(clientId) {
      const { rows } = await pool.query<Collection>(
        `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE client_id = $1 ORDER BY created_at`,
        [clientId],
      );
      return rows;
    },

    async getCollection(clientId, collectionId) {
      const { rows } = await pool.query<Collection>(
        `SELECT ${COLLECTION_COLUMNS} FROM collections WHERE id = $1 AND client_id = $2`,
        [collectionId, clientId],
      );
      return rows[0] ?? null;
    },

    async listDocuments(clientId, collectionId) {
      const { rows } = await pool.query<DocumentSummary>(
        `SELECT d.id, d.filename, d.mime_type AS "mimeType", d.status,
                d.chunk_count AS "chunkCount", d.created_at AS "createdAt"
           FROM documents d
           JOIN collections c ON c.id = d.collection_id
          WHERE d.collection_id = $1 AND c.client_id = $2
          ORDER BY d.created_at`,
        [collectionId, clientId],
      );
      return rows;
    },
  };
}

/** TEMPORARY (removed in Stage 4): a fixed tenant until real client-credentials auth exists. */
export async function ensureDevClient(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO clients (client_id, secret_hash, name, scopes)
     VALUES ('dev', '!no-login', 'Development client', '{}')
     ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id
     RETURNING id`,
  );
  return rows[0]!.id;
}
