import { describe, expect, it } from "vitest";
import { createTranslationStrategy } from "../../src/translation/strategy-factory.js";
import { MockTranslationStrategy } from "../../src/translation/providers/mock-translation-strategy.js";
import { ClaudeTranslationStrategy } from "../../src/translation/providers/claude-translation-strategy.js";
import { AuthenticationError } from "../../src/domain/errors.js";
import { envSchema } from "../../src/config/schema.js";

describe("createTranslationStrategy", () => {
  it("returns MockTranslationStrategy for LLM_PROVIDER=mock", () => {
    const env = envSchema.parse({ LLM_PROVIDER: "mock" });
    const strategy = createTranslationStrategy(env);
    expect(strategy).toBeInstanceOf(MockTranslationStrategy);
  });

  it("returns ClaudeTranslationStrategy for LLM_PROVIDER=claude with an API key", () => {
    const env = envSchema.parse({ LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "sk-test" });
    const strategy = createTranslationStrategy(env);
    expect(strategy).toBeInstanceOf(ClaudeTranslationStrategy);
  });

  it("throws AuthenticationError for LLM_PROVIDER=claude without an API key", () => {
    const env = envSchema.parse({ LLM_PROVIDER: "claude" });
    expect(() => createTranslationStrategy(env)).toThrow(AuthenticationError);
  });
});
