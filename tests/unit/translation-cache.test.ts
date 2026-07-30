import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/persistence/database.js";
import { TranslationCache, computeCacheKey } from "../../src/persistence/translation-cache.js";

describe("computeCacheKey", () => {
  it("is deterministic for identical inputs", () => {
    const input = {
      sourceLanguage: "fr" as const,
      targetLanguage: "en" as const,
      provider: "mock",
      model: "mock-1",
      normalizedSourceText: "Bonjour.",
    };
    expect(computeCacheKey(input)).toBe(computeCacheKey(input));
  });

  it("differs when the model changes", () => {
    const base = {
      sourceLanguage: "fr" as const,
      targetLanguage: "en" as const,
      provider: "claude",
      normalizedSourceText: "Bonjour.",
    };
    expect(computeCacheKey({ ...base, model: "model-a" })).not.toBe(
      computeCacheKey({ ...base, model: "model-b" }),
    );
  });

  it("differs when the direction changes", () => {
    const base = {
      provider: "mock",
      model: "mock-1",
      normalizedSourceText: "Bonjour.",
    };
    expect(
      computeCacheKey({ ...base, sourceLanguage: "fr", targetLanguage: "en" }),
    ).not.toBe(computeCacheKey({ ...base, sourceLanguage: "en", targetLanguage: "fr" }));
  });
});

describe("TranslationCache", () => {
  it("returns undefined for a cache miss and the stored value for a hit", () => {
    const db = openDatabase(":memory:");
    const cache = new TranslationCache(db);
    const key = computeCacheKey({
      sourceLanguage: "fr",
      targetLanguage: "en",
      provider: "mock",
      model: "mock-1",
      normalizedSourceText: "Bonjour.",
    });

    expect(cache.get(key)).toBeUndefined();
    cache.set(key, "Hello.");
    expect(cache.get(key)).toBe("Hello.");
  });

  it("overwrites an existing entry on re-set", () => {
    const db = openDatabase(":memory:");
    const cache = new TranslationCache(db);
    const key = "fixed-key";
    cache.set(key, "first");
    cache.set(key, "second");
    expect(cache.get(key)).toBe("second");
  });
});
