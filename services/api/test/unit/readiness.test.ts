import { describe, expect, it } from 'vitest';
import { checkReadiness } from '../../src/observability/readiness.js';

describe('checkReadiness', () => {
  it('is ready only when every dependency check passes', async () => {
    const ok = await checkReadiness({ a: async () => 1, b: async () => 2 });
    expect(ok.ready).toBe(true);
    const bad = await checkReadiness({ a: async () => 1, b: async () => Promise.reject(new Error('down')) });
    expect(bad.ready).toBe(false);
    expect(bad.checks.b).toMatchObject({ ok: false, error: 'down' });
  });

  it('times out a hung dependency instead of hanging the probe', async () => {
    const result = await checkReadiness({ hung: () => new Promise(() => {}) }, 50);
    expect(result.checks.hung).toMatchObject({ ok: false, error: 'timeout after 50ms' });
  });
});
