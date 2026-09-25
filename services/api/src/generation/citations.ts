import type { Source } from './prompt.js';
import { REFUSAL } from './prompt.js';

export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  filename: string;
  label: string;
  snippet: string;
}

// [1]  [1, 3]  [2][3]  — the last form is matched as two separate brackets.
const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Map [n] markers in the answer back to the sources that were actually in the prompt.
 * Numbers that don't correspond to a provided source are hallucinated citations: they are
 * reported (for metrics / display) and never resolved to a document.
 */
export function extractCitations(answer: string, sources: Source[]): { citations: Citation[]; invalid: number[] } {
  const byIndex = new Map(sources.map((s) => [s.index, s]));
  const seen = new Set<number>();
  const citations: Citation[] = [];
  const invalid = new Set<number>();

  for (const match of answer.matchAll(CITATION)) {
    for (const n of match[1]!.split(',').map((s) => Number(s.trim()))) {
      if (seen.has(n)) continue;
      seen.add(n);
      const source = byIndex.get(n);
      if (!source) {
        invalid.add(n);
        continue;
      }
      citations.push({
        index: n,
        chunkId: source.chunk.chunkId,
        documentId: source.chunk.documentId,
        filename: source.chunk.filename,
        label: source.label,
        snippet: source.chunk.content.slice(0, 200),
      });
    }
  }
  return { citations, invalid: [...invalid] };
}

export const isRefusal = (answer: string) =>
  answer.toLowerCase().includes(REFUSAL.toLowerCase().replace(/\.$/, '')) || /^i don'?t know\b/i.test(answer.trim());
