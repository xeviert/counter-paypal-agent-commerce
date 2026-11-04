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
  // Read from process.env by lib/ai and lib/shop/listing-runner (the workflow service has no PayPal
  // vars, so it can't use getEnv); listed here so the web service validates them on boot.
  AI_DAILY_CALL_CAP: z.coerce.number().int().min(0).default(300),
  LISTING_RUNNER: z.enum(["inline", "workflow"]).default("inline"),
  LISTING_WORKFLOW_SLUG: later,
  RENDER_API_KEY: later, // workflow runner only
  // Optional here so scripts and the cron job boot without it; lib/auth/session.ts requires it.
  SESSION_SECRET: required.min(32).optional(),
  /** Shows one-tap sign-in as a seeded demo maker on /s/login. For judges; sandbox only. */
  DEMO_LOGIN: z.stringbool().default(false),
  OPS_PASSWORD: later, // P3 operator console
  /** AG Studio license (BUILDOUT §7.3). Sent to the browser: Studio checks it client-side. Unset = trial watermark. */
  AG_STUDIO_LICENSE_KEY: later,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Blank values (`KEY=` from .env.example, empty Render prompts) count as unset;
  // otherwise z.coerce.number turns "" into 0.
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value?.trim()));
  // Render sets RENDER_EXTERNAL_URL on web services, so APP_BASE_URL only needs setting for a custom domain.
  present.APP_BASE_URL ??= present.RENDER_EXTERNAL_URL;
  const result = envSchema.safeParse(present);
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
