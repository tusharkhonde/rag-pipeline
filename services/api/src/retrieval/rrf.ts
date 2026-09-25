/**
 * Reciprocal Rank Fusion (Cormack et al., 2009).
 *
 *   score(d) = Σ over lists of 1 / (k + rank(d))      (rank is 1-based)
 *
 * Why ranks and not scores: cosine similarity (0..1) and ts_rank (unbounded, corpus-dependent)
 * live on incomparable scales, so any weighted sum of raw scores needs per-corpus tuning.
 * Ranks are scale-free. k (60 in the paper) damps the head: rank 1 vs 2 matters, but not so
 * much that one list's top hit always wins. A document found by both lists gets both terms,
 * which is exactly the "two independent signals agree" boost we want.
 */
export function reciprocalRankFusion<T>(
  lists: T[][],
  keyOf: (item: T) => string,
  k = 60,
): { item: T; score: number; sources: number[] }[] {
  const fused = new Map<string, { item: T; score: number; sources: number[] }>();
  lists.forEach((list, listIndex) => {
    list.forEach((item, i) => {
      const key = keyOf(item);
      const entry = fused.get(key) ?? { item, score: 0, sources: [] };
      entry.score += 1 / (k + i + 1);
      entry.sources.push(listIndex);
      fused.set(key, entry);
    });
  });
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
