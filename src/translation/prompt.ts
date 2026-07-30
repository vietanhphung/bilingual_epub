import type { SupportedLanguage } from "../domain/translation.js";

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  fr: "French",
};

export function languageName(code: SupportedLanguage): string {
  return LANGUAGE_NAMES[code];
}

/** Prompt version pinned into the translation cache key (see TranslationCache). */
export const TRANSLATION_PROMPT_VERSION = "v1";

export function buildSystemPrompt(): string {
  return [
    "You are a professional literary translator working paragraph by paragraph inside an automated pipeline.",
    "You will receive a batch of source-language paragraphs, each with a stable id, and must translate each one independently and completely.",
    "",
    "Rules:",
    "- Preserve paragraph boundaries: one input paragraph produces exactly one translated paragraph.",
    "- Preserve names, dialogue, punctuation, numbers, dates, URLs, and footnote markers.",
    '- The text may contain placeholder tags like <x-inline data-id="inline-1">...</x-inline>. These mark inline formatting (italics, bold, links, etc). You MUST keep every placeholder tag in your output, with the same data-id, wrapping the translated content that was inside it. Never remove, rename, or merge placeholder tags.',
    "- Translate for natural, idiomatic reading in the target language while staying faithful to meaning and tone.",
    "- Do not add commentary, notes, or explanations. Only return the translated text for each segment.",
    "- You must call the submit_translations tool exactly once with a translation for every segment id you were given, and no others.",
  ].join("\n");
}

export function buildUserMessage(
  segments: Array<{ id: string; text: string }>,
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
): string {
  const payload = {
    sourceLanguage: languageName(sourceLanguage),
    targetLanguage: languageName(targetLanguage),
    segments,
  };
  return JSON.stringify(payload, null, 2);
}

export const SUBMIT_TRANSLATIONS_TOOL_NAME = "submit_translations";

export const SUBMIT_TRANSLATIONS_TOOL_SCHEMA = {
  name: SUBMIT_TRANSLATIONS_TOOL_NAME,
  description:
    "Submit the translation for every requested segment id, in any order.",
  input_schema: {
    type: "object" as const,
    properties: {
      translations: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "string" as const },
            translatedText: { type: "string" as const },
          },
          required: ["id", "translatedText"],
        },
      },
    },
    required: ["translations"],
  },
};
