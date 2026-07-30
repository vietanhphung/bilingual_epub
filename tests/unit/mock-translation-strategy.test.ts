import { describe, expect, it } from "vitest";
import { MockTranslationStrategy } from "../../src/translation/providers/mock-translation-strategy.js";

describe("MockTranslationStrategy", () => {
  it("translates every requested segment and preserves placeholders verbatim", async () => {
    const strategy = new MockTranslationStrategy();
    const request = {
      segments: [
        {
          id: "seg-1",
          sourceLanguage: "fr" as const,
          targetLanguage: "en" as const,
          text: 'Il regarda <x-inline data-id="inline-1">la mer</x-inline>.',
          protectedPlaceholders: ['<x-inline data-id="inline-1">'],
        },
      ],
    };

    const result = await strategy.translateBatch(request);
    expect(result.translations).toHaveLength(1);
    expect(result.translations[0]!.id).toBe("seg-1");
    expect(result.translations[0]!.translatedText).toContain(
      '<x-inline data-id="inline-1">la mer</x-inline>',
    );
    expect(result.translations[0]!.translatedText.startsWith("[EN]")).toBe(true);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("never makes a network call and resolves synchronously fast for countTokens", async () => {
    const strategy = new MockTranslationStrategy();
    const estimate = await strategy.countTokens({
      segments: [
        {
          id: "a",
          sourceLanguage: "en",
          targetLanguage: "fr",
          text: "Hello world",
          protectedPlaceholders: [],
        },
      ],
    });
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
  });
});
