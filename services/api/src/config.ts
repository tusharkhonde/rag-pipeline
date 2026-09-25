import { z } from 'zod';

// Validate env once at startup and fail fast with a readable error,
// instead of discovering a missing variable on the first request that needs it.
const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ML_URL: z.string().default('http://localhost:8000'),
  LLM_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_MODEL: z.string().default('qwen2.5:7b'),
  LLM_API_KEY: z.string().default('ollama'),
  RETRIEVAL_MODE: z.enum(['hybrid', 'vector', 'keyword']).default('hybrid'),
  RETRIEVAL_CANDIDATES: z.coerce.number().int().min(1).max(200).default(20), // per retriever, before fusion
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(5), // chunks handed to the LLM
  HNSW_EF_SEARCH: z.coerce.number().int().min(10).max(1000).default(100),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  LLM_MAX_TOKENS: z.coerce.number().int().min(16).max(4096).default(512),
  // Budget for retrieved text in the prompt. Must fit the model's context window together with
  // the system prompt, question and answer (Ollama is configured for 8192 in docker-compose.yml).
  MAX_CONTEXT_TOKENS: z.coerce.number().int().min(256).default(3000),
  ANSWER_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  MIGRATIONS_DIR: z.string().default(new URL('../../../db/migrations', import.meta.url).pathname),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
