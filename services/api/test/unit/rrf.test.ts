import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../../src/retrieval/rrf.js';

const id = (s: string) => s;

describe('reciprocalRankFusion', () => {
  it('scores by 1/(k + rank) and sums across lists', () => {
    const [top] = reciprocalRankFusion([['a', 'b'], ['a']], id, 60);
    expect(top!.item).toBe('a');
    expect(top!.score).toBeCloseTo(1 / 61 + 1 / 61);
    expect(top!.sources).toEqual([0, 1]);
  });

  it('ranks an item found by both lists above items each list ranks first alone', () => {
    // 'c' is only 2nd in each list, but agreement between two signals beats one first place.
    const fused = reciprocalRankFusion([['a', 'c'], ['b', 'c']], id);
    expect(fused.map((f) => f.item)).toEqual(['c', 'a', 'b']);
  });

  it('ignores raw scores entirely: only ranks matter', () => {
    const vector = [{ id: 'x', score: 0.99 }, { id: 'y', score: 0.98 }];
    const keyword = [{ id: 'y', score: 42 }];
    expect(reciprocalRankFusion([vector, keyword], (d) => d.id)[0]!.item.id).toBe('y');
  });

  it('handles empty lists', () => {
    expect(reciprocalRankFusion([[], []], id)).toEqual([]);
    expect(reciprocalRankFusion([['a'], []], id).map((f) => f.item)).toEqual(['a']);
  });
});
