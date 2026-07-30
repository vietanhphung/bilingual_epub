import { createHash } from "node:crypto";
import type { AppDatabase } from "./database.js";
import type { SupportedLanguage } from "../domain/translation.js";
import { TRANSLATION_PROMPT_VERSION } from "../translation/prompt.js";

export interface CacheKeyInput {
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  provider: string;
  model: string;
  normalizedSourceText: string;
}

export function computeCacheKey(input: CacheKeyInput): string {
  return createHash("sha256")
    .update(
      input.sourceLanguage +
        input.targetLanguage +
        input.provider +
        input.model +
        TRANSLATION_PROMPT_VERSION +
        input.normalizedSourceText,
    )
    .digest("hex");
}

/**
 * Caches translated text (pre-placeholder-reconstruction, as returned by
 * the provider) by content + direction + provider + model + prompt
 * version, so re-running a job — or translating the same paragraph in a
 * different book — never re-pays for an identical translation.
 */
export class TranslationCache {
  constructor(private readonly db: AppDatabase) {}

  get(cacheKey: string): string | undefined {
    const row = this.db
      .prepare("SELECT translated_text FROM translation_cache WHERE cache_key = ?")
      .get(cacheKey) as { translated_text: string } | undefined;
    return row?.translated_text;
  }

  set(cacheKey: string, translatedText: string): void {
    this.db
      .prepare(
        `INSERT INTO translation_cache (cache_key, translated_text, created_at)
         VALUES (@cacheKey, @translatedText, @now)
         ON CONFLICT(cache_key) DO UPDATE SET translated_text = @translatedText`,
      )
      .run({ cacheKey, translatedText, now: new Date().toISOString() });
  }
}
