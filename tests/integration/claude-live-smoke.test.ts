import { describe, expect, it } from "vitest";
import { ClaudeTranslationStrategy } from "../../src/translation/providers/claude-translation-strategy.js";

const shouldRun = process.env["RUN_LIVE_LLM_TESTS"] === "true" && !!process.env["ANTHROPIC_API_KEY"];

/**
 * Optional smoke test against the real Anthropic API. Skipped by default —
 * enable with RUN_LIVE_LLM_TESTS=true and a valid ANTHROPIC_API_KEY. Never
 * runs in the default test suite, per the "no paid provider calls by
 * default" requirement.
 */
describe.skipIf(!shouldRun)("ClaudeTranslationStrategy (live)", () => {
  it("translates a small batch and returns a result for every requested id", async () => {
    const strategy = new ClaudeTranslationStrategy({
      apiKey: process.env["ANTHROPIC_API_KEY"]!,
      model: process.env["LLM_MODEL"] ?? "claude-sonnet-5",
    });

    const request = {
      segments: [
        {
          id: "smoke-1",
          sourceLanguage: "fr" as const,
          targetLanguage: "en" as const,
          text: "Il faisait encore nuit lorsqu'elle quitta la maison.",
          protectedPlaceholders: [],
        },
        {
          id: "smoke-2",
          sourceLanguage: "fr" as const,
          targetLanguage: "en" as const,
          text: 'Il regarda <x-inline data-id="inline-1">la mer</x-inline> pendant plusieurs minutes.',
          protectedPlaceholders: ['<x-inline data-id="inline-1">'],
        },
      ],
    };

    const result = await strategy.translateBatch(request);
    const ids = result.translations.map((t) => t.id).sort();
    expect(ids).toEqual(["smoke-1", "smoke-2"]);
    for (const translation of result.translations) {
      expect(translation.translatedText.trim().length).toBeGreaterThan(0);
    }
    const inlineTranslation = result.translations.find((t) => t.id === "smoke-2")!;
    expect(inlineTranslation.translatedText).toContain('<x-inline data-id="inline-1">');
  }, 30000);
});
