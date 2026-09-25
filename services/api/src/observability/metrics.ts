import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { AnswerResult } from '../generation/answerer.js';
import type { RetrieveResult } from '../retrieval/retriever.js';

/**
 * Prometheus metrics. Histograms (not summaries) for latency: buckets aggregate across
 * instances, so p95 over a whole fleet is computable in PromQL; summaries' quantiles can't be
 * averaged. Labels are kept low-cardinality (route templates, stage names; never raw URLs,
 * questions or tenant ids), since every label combination is a separate time series.
 */
export function createMetrics(opts: { hitThreshold: number }) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry }); // process CPU/memory, event-loop lag, GC

  const httpDuration = new Histogram({
    name: 'rag_http_request_duration_seconds',
    help: 'HTTP request latency by route template',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [registry],
  });
  const stageDuration = new Histogram({
    name: 'rag_stage_duration_seconds',
    help: 'Latency of each RAG pipeline stage (embed, vector_search, keyword_search, ttft, generate, total)',
    labelNames: ['stage'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
    registers: [registry],
  });
  const llmTokens = new Counter({
    name: 'rag_llm_tokens_total',
    help: 'LLM tokens consumed, by type',
    labelNames: ['type'],
    registers: [registry],
  });
  const cacheRequests = new Counter({
    name: 'rag_cache_requests_total',
    help: 'Cache lookups by cache and result',
    labelNames: ['cache', 'result'],
    registers: [registry],
  });
  const retrievals = new Counter({
    name: 'rag_retrieval_queries_total',
    help: `Retrievals by outcome. hit = top vector similarity >= ${opts.hitThreshold} (keyword mode: any result)`,
    labelNames: ['mode', 'outcome'],
    registers: [registry],
  });
  const topScore = new Histogram({
    name: 'rag_retrieval_top_vector_score',
    help: 'Best cosine similarity per query; its distribution is what you tune the hit threshold against',
    buckets: [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9],
    registers: [registry],
  });
  const answers = new Counter({
    name: 'rag_answers_total',
    help: 'Answers by outcome (answered/refused) and whether they came from cache',
    labelNames: ['outcome', 'cached'],
    registers: [registry],
  });
  const invalidCitations = new Counter({
    name: 'rag_invalid_citations_total',
    help: 'Citations to source numbers that were not in the prompt (hallucinated citations)',
    registers: [registry],
  });

  const isHit = (r: Pick<RetrieveResult, 'mode' | 'topVectorScore' | 'chunks'>) =>
    r.mode === 'keyword' ? r.chunks.length > 0 : (r.topVectorScore ?? 0) >= opts.hitThreshold;

  function observeStages(timings: Record<string, number>) {
    for (const [stage, ms] of Object.entries(timings)) stageDuration.observe({ stage }, ms / 1000);
  }

  function observeRetrieval(r: RetrieveResult) {
    observeStages(r.timings);
    retrievals.inc({ mode: r.mode, outcome: isHit(r) ? 'hit' : 'miss' });
    if (r.topVectorScore !== null) topScore.observe(r.topVectorScore);
    if (r.embeddingCached !== null) cacheRequests.inc({ cache: 'embedding', result: r.embeddingCached ? 'hit' : 'miss' });
  }

  function observeAnswer(a: AnswerResult) {
    cacheRequests.inc({ cache: 'answer', result: a.cached ? 'hit' : 'miss' });
    answers.inc({ outcome: a.refused ? 'refused' : 'answered', cached: String(a.cached) });
    observeStages(a.timings);
    if (a.cached) return; // retrieval and generation didn't run
    retrievals.inc({ mode: a.retrieval.mode, outcome: isHit({ ...a.retrieval, chunks: a.sources as never[] }) ? 'hit' : 'miss' });
    if (a.retrieval.topVectorScore !== null) topScore.observe(a.retrieval.topVectorScore);
    if (a.retrieval.embeddingCached !== null) {
      cacheRequests.inc({ cache: 'embedding', result: a.retrieval.embeddingCached ? 'hit' : 'miss' });
    }
    if (a.usage) {
      llmTokens.inc({ type: 'prompt' }, a.usage.promptTokens);
      llmTokens.inc({ type: 'completion' }, a.usage.completionTokens);
    }
    if (a.invalidCitations.length) invalidCitations.inc(a.invalidCitations.length);
  }

  return { registry, httpDuration, observeRetrieval, observeAnswer, isHit };
}

export type Metrics = ReturnType<typeof createMetrics>;
