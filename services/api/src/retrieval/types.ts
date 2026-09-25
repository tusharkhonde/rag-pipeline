export type RetrievalMode = 'hybrid' | 'vector' | 'keyword';

export interface ChunkMetadata {
  page?: number;
  heading_path?: string[];
  char_start?: number;
  char_end?: number;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  ordinal: number;
  content: string;
  metadata: ChunkMetadata;
  /** Ranking score for the chosen mode: RRF score (hybrid), cosine similarity (vector), ts_rank (keyword). */
  score: number;
  /** Cosine similarity to the query, when the chunk came from vector search. Comparable across queries. */
  vectorScore?: number;
  keywordScore?: number;
}
