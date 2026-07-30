import { describe, expect, it } from "vitest";
import { bookConfigSchema, envSchema } from "../../src/config/schema.js";

describe("bookConfigSchema", () => {
  it("accepts valid fr->en config", () => {
    const result = bookConfigSchema.parse({
      sourceLanguage: "fr",
      targetLanguage: "en",
    });
    expect(result.displayOrder).toBe("ENGLISH_FIRST");
    expect(result.granularity).toBe("PARAGRAPH");
  });

  it("rejects identical source and target languages", () => {
    expect(() =>
      bookConfigSchema.parse({ sourceLanguage: "en", targetLanguage: "en" }),
    ).toThrow();
  });

  it("rejects unsupported languages", () => {
    expect(() =>
      bookConfigSchema.parse({ sourceLanguage: "de", targetLanguage: "en" }),
    ).toThrow();
  });
});

describe("envSchema", () => {
  it("applies documented defaults", () => {
    const env = envSchema.parse({});
    expect(env.LLM_PROVIDER).toBe("claude");
    expect(env.SCHEDULE_MODE).toBe("MANUAL");
    expect(env.MAX_SOURCE_TOKENS_PER_REQUEST).toBe(8000);
    expect(env.TOKEN_SAFETY_MARGIN_PERCENT).toBe(20);
  });

  it("coerces numeric env strings", () => {
    const env = envSchema.parse({
      MAX_REQUESTS_PER_RUN: "25",
      MAX_INPUT_TOKENS_PER_RUN: "250000",
    });
    expect(env.MAX_REQUESTS_PER_RUN).toBe(25);
    expect(env.MAX_INPUT_TOKENS_PER_RUN).toBe(250_000);
  });

  it("leaves optional monetary budgets undefined when unset", () => {
    const env = envSchema.parse({});
    expect(env.MAX_COST_PER_RUN_USD).toBeUndefined();
  });

  it("rejects an invalid schedule time format", () => {
    expect(() => envSchema.parse({ SCHEDULE_TIME: "25:99" })).toThrow();
  });
});
