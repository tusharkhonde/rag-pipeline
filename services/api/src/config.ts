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
