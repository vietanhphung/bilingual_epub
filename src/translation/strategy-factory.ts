import type { AppEnv } from "../config/schema.js";
import { AuthenticationError } from "../domain/errors.js";
import type { TranslationStrategy } from "../domain/translation.js";
import { ClaudeTranslationStrategy } from "./providers/claude-translation-strategy.js";
import { MockTranslationStrategy } from "./providers/mock-translation-strategy.js";

/**
 * Selects a TranslationStrategy from configuration alone — provider choice
 * must never be decided autonomously elsewhere (CLI, orchestrator, LLM).
 */
export function createTranslationStrategy(env: AppEnv): TranslationStrategy {
  switch (env.LLM_PROVIDER) {
    case "mock":
      return new MockTranslationStrategy();
    case "claude": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new AuthenticationError(
          "ANTHROPIC_API_KEY is not set. Add it to .env or your environment before using LLM_PROVIDER=claude.",
        );
      }
      return new ClaudeTranslationStrategy({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.LLM_MODEL,
        maxRetries: env.MAX_RETRIES_PER_SEGMENT,
      });
    }
  }
}
