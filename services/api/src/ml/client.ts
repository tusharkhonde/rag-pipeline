export interface IngestResult {
  document_id: string;
  created: boolean;
  chunk_count: number;
}

export interface UploadedFile {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** Error from the ml service that should be passed through to the API caller as-is (4xx). */
export class MlClientError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MlClient {
  ingest(collectionId: string, file: UploadedFile): Promise<IngestResult>;
}

export function createMlClient(baseUrl: string, fetchImpl: typeof fetch = fetch): MlClient {
  return {
    async ingest(collectionId, file) {
      const form = new FormData();
      form.append('collection_id', collectionId);
      form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.filename);

      // Ingest embeds on CPU, so a large PDF can take a while; still bound it.
      const res = await fetchImpl(`${baseUrl}/ingest`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(300_000),
      });
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (res.status >= 400 && res.status < 500) {
        throw new MlClientError(res.status, typeof body.detail === 'string' ? body.detail : 'Invalid document');
      }
      if (!res.ok) throw new Error(`ml /ingest failed with ${res.status}`);
      return body as IngestResult;
    },
  };
}
