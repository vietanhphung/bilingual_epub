import { z } from "zod";

export const supportedLanguageSchema = z.enum(["en", "fr"]);
export const displayOrderSchema = z.enum(["ENGLISH_FIRST", "FRENCH_FIRST"]);
export const granularitySchema = z.literal("PARAGRAPH");
export const scheduleModeSchema = z.enum(["MANUAL", "DAILY", "WEEKLY"]);
export const dayOfWeekSchema = z.enum([
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
]);

/** Numeric env vars arrive as strings; coerce and require non-negative integers. */
const nonNegativeIntFromEnv = (fallback: number) =>
  z.coerce.number().int().nonnegative().default(fallback);

const optionalPositiveNumberFromEnv = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
  .refine((v) => v === undefined || (Number.isFinite(v) && v > 0), {
    message: "must be a positive number",
  });

export const envSchema = z.object({
  LLM_PROVIDER: z.enum(["claude", "mock"]).default("claude"),
  LLM_MODEL: z.string().min(1).default("claude-sonnet-5"),
  ANTHROPIC_API_KEY: z.string().optional(),

  SCHEDULE_MODE: scheduleModeSchema.default("MANUAL"),
  SCHEDULE_TIME: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm")
    .default("02:00"),
  SCHEDULE_TIMEZONE: z.string().min(1).default("America/Toronto"),
  SCHEDULE_DAY_OF_WEEK: dayOfWeekSchema.default("SUN"),

  MAX_SOURCE_TOKENS_PER_REQUEST: nonNegativeIntFromEnv(8000),
  MAX_ESTIMATED_OUTPUT_TOKENS_PER_REQUEST: nonNegativeIntFromEnv(12000),

  MAX_REQUESTS_PER_RUN: nonNegativeIntFromEnv(10),
  MAX_INPUT_TOKENS_PER_RUN: nonNegativeIntFromEnv(100_000),
  MAX_OUTPUT_TOKENS_PER_RUN: nonNegativeIntFromEnv(140_000),

  MAX_INPUT_TOKENS_PER_DAY: nonNegativeIntFromEnv(100_000),
  MAX_OUTPUT_TOKENS_PER_DAY: nonNegativeIntFromEnv(140_000),

  MAX_INPUT_TOKENS_PER_MONTH: nonNegativeIntFromEnv(2_000_000),
  MAX_OUTPUT_TOKENS_PER_MONTH: nonNegativeIntFromEnv(2_800_000),

  TOKEN_SAFETY_MARGIN_PERCENT: z.coerce.number().min(0).max(90).default(20),
  MAX_RETRIES_PER_SEGMENT: nonNegativeIntFromEnv(3),
  REQUEST_DELAY_MS: nonNegativeIntFromEnv(1500),

  MAX_COST_PER_RUN_USD: optionalPositiveNumberFromEnv,
  MAX_COST_PER_DAY_USD: optionalPositiveNumberFromEnv,
  MAX_COST_PER_MONTH_USD: optionalPositiveNumberFromEnv,

  // Pricing is not hard-coded (provider rates change and vary by
  // account/tier); cost estimates and monetary budgets only activate
  // when the user configures these for their current model.
  MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD: optionalPositiveNumberFromEnv,
  MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD: optionalPositiveNumberFromEnv,

  DATABASE_PATH: z.string().min(1).default("./data/bilingual-epub.sqlite"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  RUN_LIVE_LLM_TESTS: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  DEBUG_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // --- Web server (ui/ + src/server) ---
  PORT: nonNegativeIntFromEnv(3001),
  WEB_APP_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  JWT_SECRET: z.string().min(1).default("dev-only-insecure-secret-change-me"),
  UPLOAD_DIR: z.string().min(1).default("./data/uploads"),
  UPLOAD_MAX_BYTES: nonNegativeIntFromEnv(80_000_000),

  // --- Billing (Stripe) ---
  // Test-mode keys from your own Stripe account (dashboard.stripe.com/test/apikeys).
  // Unset in mock/dev use — routes that need them fail fast with a clear error.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Pay-per-translation pricing: price = max(minimum, providerCost * markup).
  // Markup covers Stripe's ~2.9%+$0.30 fee, token-estimate variance, and margin.
  PLATFORM_MARKUP_MULTIPLIER: z.coerce.number().positive().default(3),
  PLATFORM_MINIMUM_CHARGE_USD_CENTS: nonNegativeIntFromEnv(50),
});

export type AppEnv = z.infer<typeof envSchema>;

export const bookConfigSchema = z
  .object({
    sourceLanguage: supportedLanguageSchema,
    targetLanguage: supportedLanguageSchema,
    displayOrder: displayOrderSchema.default("ENGLISH_FIRST"),
    granularity: granularitySchema.default("PARAGRAPH"),
  })
  .refine((cfg) => cfg.sourceLanguage !== cfg.targetLanguage, {
    message: "sourceLanguage and targetLanguage must be different",
    path: ["targetLanguage"],
  });

export type BookConfig = z.infer<typeof bookConfigSchema>;

export const schedulerPresetNameSchema = z.enum([
  "SAFE_DAILY",
  "BALANCED_DAILY",
  "WEEKLY",
  "CUSTOM",
]);
export type SchedulerPresetName = z.infer<typeof schedulerPresetNameSchema>;
