import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Collection, Repo } from '../../src/db/repo.js';
import { MlClientError, type MlClient } from '../../src/ml/client.js';

const CLIENT_A = 'client-a';
const OWNED = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222'; // exists, but belongs to another client

function fakeRepo(): Repo {
  const collection: Collection = { id: OWNED, name: 'docs', version: 0, createdAt: 'now' };
  return {
    createCollection: vi.fn(async (_c, name) => (name === 'taken' ? null : { ...collection, name })),
    listCollections: vi.fn(async () => [collection]),
    // Tenant-scoped lookup: only returns the collection when the owner matches.
    getCollection: vi.fn(async (clientId, id) => (clientId === CLIENT_A && id === OWNED ? collection : null)),
    listDocuments: vi.fn(async () => []),
  };
}

function setup(ml: Partial<MlClient> = {}) {
  const repo = fakeRepo();
  const mlClient: MlClient = {
    ingest: vi.fn(async () => ({ document_id: 'doc-1', created: true, chunk_count: 3 })),
    embed: vi.fn(),
    info: vi.fn(),
    ...ml,
  };
  const app = buildApp({
    config: loadConfig({ DATABASE_URL: 'postgres://unused', LOG_LEVEL: 'fatal' }),
    repo,
    ml: mlClient,
    retriever: { retrieve: vi.fn() },
    resolveClientId: async () => CLIENT_A,
  });
  return { app, repo, ml: mlClient };
}

function upload(filename = 'notes.md', content = '# Hi\nThere.') {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/markdown' }), filename);
  return form;
}

describe('collections routes', () => {
  it('creates a collection scoped to the calling client', async () => {
    const { app, repo } = setup();
    const res = await app.inject({ method: 'POST', url: '/collections', payload: { name: 'handbook' } });
    expect(res.statusCode).toBe(201);
    expect(repo.createCollection).toHaveBeenCalledWith(CLIENT_A, 'handbook');
  });

  it('returns 409 for a duplicate name and 400 for an invalid one', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/collections', payload: { name: 'taken' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/collections', payload: { name: '../etc' } })).statusCode).toBe(400);
  });

  it('forwards an upload for an owned collection to the ml service', async () => {
    const { app, ml } = setup();
    const res = await app.inject({ method: 'POST', url: `/collections/${OWNED}/documents`, payload: upload() });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ documentId: 'doc-1', created: true, chunkCount: 3 });
    const [collectionId, file] = vi.mocked(ml.ingest).mock.calls[0]!;
    expect(collectionId).toBe(OWNED);
    expect(file.filename).toBe('notes.md');
    expect(file.data.toString()).toBe('# Hi\nThere.');
  });

  it("returns 404 (not 403) for another client's collection and never calls ml", async () => {
    const { app, ml } = setup();
    const res = await app.inject({ method: 'POST', url: `/collections/${FOREIGN}/documents`, payload: upload() });
    expect(res.statusCode).toBe(404);
    expect(ml.ingest).not.toHaveBeenCalled();
  });

  it('returns 200 when the same file was already ingested', async () => {
    const { app } = setup({ ingest: async () => ({ document_id: 'doc-1', created: false, chunk_count: 3 }) });
    const res = await app.inject({ method: 'POST', url: `/collections/${OWNED}/documents`, payload: upload() });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
  });

  it('passes ml validation errors (e.g. 415 unsupported type) through to the caller', async () => {
    const { app } = setup({
      ingest: async () => {
        throw new MlClientError(415, 'Unsupported file type');
      },
    });
    const res = await app.inject({ method: 'POST', url: `/collections/${OWNED}/documents`, payload: upload('a.png') });
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('Unsupported file type');
  });

  it('rejects a non-uuid collection id before touching the database', async () => {
    const { app, repo } = setup();
    const res = await app.inject({ method: 'GET', url: '/collections/not-a-uuid/documents' });
    expect(res.statusCode).toBe(400);
    expect(repo.getCollection).not.toHaveBeenCalled();
  });
});
