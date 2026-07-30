import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  buildUserMessage,
  SUBMIT_TRANSLATIONS_TOOL_SCHEMA,
} from "../../src/translation/prompt.js";

describe("prompt building", () => {
  it("system prompt instructs the model to preserve placeholders and paragraph boundaries", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/x-inline/);
    expect(prompt).toMatch(/paragraph/i);
    expect(prompt).toMatch(/submit_translations/);
  });

  it("user message embeds segment ids and text as JSON", () => {
    const message = buildUserMessage(
      [{ id: "seg-1", text: "Bonjour." }],
      "fr",
      "en",
    );
    const parsed = JSON.parse(message);
    expect(parsed.segments).toEqual([{ id: "seg-1", text: "Bonjour." }]);
    expect(parsed.sourceLanguage).toBe("French");
    expect(parsed.targetLanguage).toBe("English");
  });

  it("tool schema requires id and translatedText for every array item", () => {
    expect(SUBMIT_TRANSLATIONS_TOOL_SCHEMA.input_schema.required).toEqual(["translations"]);
    expect(SUBMIT_TRANSLATIONS_TOOL_SCHEMA.input_schema.properties.translations.items.required).toEqual([
      "id",
      "translatedText",
    ]);
  });
});
