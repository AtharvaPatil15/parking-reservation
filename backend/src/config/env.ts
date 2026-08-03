import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration (P4-01/P4-02).
 * Timings/weights are NOT here — they live in SystemConfiguration (D8), read via config/systemConfig.
 */
// The dev fallbacks keep local/test setup zero-config, but they are PUBLIC values — a JWT signed
// with them can be forged by anyone. In production a real secret is mandatory (enforced below).
const DEV_ACCESS_SECRET = 'dev-access-secret-change-me';
const DEV_REFRESH_SECRET = 'dev-refresh-secret-change-me';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().min(1).default(DEV_ACCESS_SECRET),
    JWT_REFRESH_SECRET: z.string().min(1).default(DEV_REFRESH_SECRET),
    ACCESS_TOKEN_TTL: z.coerce.number().default(900), // seconds
    REFRESH_TOKEN_TTL: z.coerce.number().default(604800), // seconds (7d)
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    LOG_LEVEL: z.string().default('info'),
  })
  // In production, refuse to boot with a missing/known/weak JWT secret — otherwise tokens are forgeable.
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    const checks: [keyof typeof cfg, string, string][] = [
      ['JWT_ACCESS_SECRET', cfg.JWT_ACCESS_SECRET, DEV_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', cfg.JWT_REFRESH_SECRET, DEV_REFRESH_SECRET],
    ];
    for (const [key, value, devDefault] of checks) {
      if (value === devDefault || value.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${String(key)} must be set to a strong secret (>= 32 chars) in production`,
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
