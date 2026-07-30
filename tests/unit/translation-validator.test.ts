import { describe, expect, it } from "vitest";
import { validateTranslationBatch } from "../../src/translation/translation-validator.js";
import type { TranslationBatchRequest, TranslationBatchResult } from "../../src/domain/translation.js";

function request(overrides: Partial<TranslationBatchRequest["segments"][number]> = {}): TranslationBatchRequest {
  return {
    segments: [
      {
        id: "seg-1",
        sourceLanguage: "fr",
        targetLanguage: "en",
        text: "Il faisait encore nuit.",
        protectedPlaceholders: [],
        ...overrides,
      },
    ],
  };
}

describe("validateTranslationBatch", () => {
  it("accepts a well-formed, distinct translation", () => {
    const req = request();
    const result: TranslationBatchResult = {
      translations: [{ id: "seg-1", translatedText: "It was still dark." }],
      usage: { inputTokens: 10, outputTokens: 8 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.valid.get("seg-1")).toBe("It was still dark.");
    expect(outcome.rejected).toEqual([]);
    expect(outcome.missingIds).toEqual([]);
  });

  it("flags a blank translation", () => {
    const req = request();
    const result: TranslationBatchResult = {
      translations: [{ id: "seg-1", translatedText: "   " }],
      usage: { inputTokens: 10, outputTokens: 0 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]!.reason).toMatch(/blank/);
  });

  it("flags a translation identical to substantive source text", () => {
    const req = request({ text: "Il faisait encore nuit." });
    const result: TranslationBatchResult = {
      translations: [{ id: "seg-1", translatedText: "Il faisait encore nuit." }],
      usage: { inputTokens: 10, outputTokens: 10 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]!.reason).toMatch(/identical/);
  });

  it("allows an identical translation for language-neutral text (a name)", () => {
    const req = request({ text: "42" });
    const result: TranslationBatchResult = {
      translations: [{ id: "seg-1", translatedText: "42" }],
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.valid.get("seg-1")).toBe("42");
  });

  it("flags a missing protected placeholder", () => {
    const req = request({
      text: 'Il regarda <x-inline data-id="inline-1">la mer</x-inline>.',
      protectedPlaceholders: ['<x-inline data-id="inline-1">'],
    });
    const result: TranslationBatchResult = {
      translations: [{ id: "seg-1", translatedText: "He looked at the sea." }],
      usage: { inputTokens: 10, outputTokens: 8 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]!.reason).toMatch(/placeholder/);
  });

  it("reports IDs the provider never returned", () => {
    const req = request();
    const result: TranslationBatchResult = {
      translations: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.missingIds).toEqual(["seg-1"]);
  });

  it("reports unexpected IDs not present in the request", () => {
    const req = request();
    const result: TranslationBatchResult = {
      translations: [
        { id: "seg-1", translatedText: "It was still dark." },
        { id: "seg-ghost", translatedText: "Unexpected." },
      ],
      usage: { inputTokens: 10, outputTokens: 8 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.unexpectedIds).toEqual(["seg-ghost"]);
  });

  it("reports duplicate IDs and only keeps the first occurrence", () => {
    const req = request();
    const result: TranslationBatchResult = {
      translations: [
        { id: "seg-1", translatedText: "It was still dark." },
        { id: "seg-1", translatedText: "A different translation." },
      ],
      usage: { inputTokens: 10, outputTokens: 8 },
    };
    const outcome = validateTranslationBatch(req, result);
    expect(outcome.duplicateIds).toEqual(["seg-1"]);
    expect(outcome.valid.get("seg-1")).toBe("It was still dark.");
  });
});
