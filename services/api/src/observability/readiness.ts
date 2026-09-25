export interface CheckResult {
  ok: boolean;
  ms: number;
  error?: string;
}

export type ReadinessCheck = () => Promise<unknown>;

/**
 * Readiness: "can this instance serve traffic right now?" Unlike liveness (/health), this checks
 * dependencies, and a load balancer should stop routing to an instance that fails it, not
 * restart it. Checks run in parallel with a timeout, so one hung dependency can't hang the probe.
 */
export async function checkReadiness(
  checks: Record<string, ReadinessCheck>,
  timeoutMs = 2_000,
): Promise<{ ready: boolean; checks: Record<string, CheckResult> }> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, CheckResult]> => {
      const start = performance.now();
      try {
        await Promise.race([
          check(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
        ]);
        return [name, { ok: true, ms: Math.round(performance.now() - start) }];
      } catch (err) {
        return [name, { ok: false, ms: Math.round(performance.now() - start), error: (err as Error).message }];
      }
    }),
  );
  const results = Object.fromEntries(entries);
  return { ready: entries.every(([, r]) => r.ok), checks: results };
}
