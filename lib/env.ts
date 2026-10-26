import { z } from "zod";

const required = z.string().trim().min(1);

// Optional until the phase that first needs them, then flip to `required`.
const later = required.optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url().transform((url) => url.replace(/\/+$/, "")),

  PAYPAL_ENVIRONMENT: z.enum(["SANDBOX", "LIVE"]).default("SANDBOX"),
  PLATFORM_CLIENT_ID: required,
  PLATFORM_CLIENT_SECRET: required,
  PLATFORM_MERCHANT_ID: required,
  PAYPAL_WEBHOOK_ID: later, // P0 spike 11
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(500),
  // Fractional values allowed so the demo can release after minutes.
  RELEASE_AFTER_DAYS: z.coerce.number().positive().default(14),

  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  ANTHROPIC_API_KEY: later, // P2 listing pipeline
  SESSION_SECRET: required.min(32).optional(), // P2 maker sessions
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
