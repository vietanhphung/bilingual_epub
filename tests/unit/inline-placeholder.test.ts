import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import {
  placeholderizeInlineContent,
  reconstructInlineContent,
} from "../../src/epub/inline-placeholder.js";

function loadRoot(innerHtml: string) {
  const $ = cheerio.load(`<x-root>${innerHtml}</x-root>`, { xmlMode: true });
  return { $, root: $("x-root")[0]! };
}

describe("inline placeholder round trip", () => {
  it("wraps a single inline element and reconstructs it", () => {
    const { $, root } = loadRoot(
      "Il regarda <em>la mer</em> pendant plusieurs minutes.",
    );
    const { text, placeholders } = placeholderizeInlineContent($, root);

    expect(text).toBe(
      'Il regarda <x-inline data-id="inline-1">la mer</x-inline> pendant plusieurs minutes.',
    );
    expect(placeholders).toEqual([
      { id: "inline-1", tagName: "em", attribs: {} },
    ]);

    const reconstructed = reconstructInlineContent(text, placeholders);
    expect(reconstructed).toBe(
      "Il regarda <em>la mer</em> pendant plusieurs minutes.",
    );
  });

  it("handles nested inline elements and preserves attributes", () => {
    const { $, root } = loadRoot(
      'See <a href="chapter2.xhtml" class="ref"><strong>chapter two</strong></a> now.',
    );
    const { text, placeholders } = placeholderizeInlineContent($, root);
    expect(placeholders).toHaveLength(2);

    const reconstructed = reconstructInlineContent(text, placeholders);
    expect(reconstructed).toBe(
      'See <a href="chapter2.xhtml" class="ref"><strong>chapter two</strong></a> now.',
    );
  });

  it("returns null when translated text drops a required placeholder", () => {
    const { $, root } = loadRoot("Hello <em>world</em>.");
    const { placeholders } = placeholderizeInlineContent($, root);

    const brokenTranslation = "Bonjour monde.";
    expect(reconstructInlineContent(brokenTranslation, placeholders)).toBeNull();
  });

  it("returns null when a placeholder id is unrecognized", () => {
    const { $, root } = loadRoot("Hello <em>world</em>.");
    const { placeholders } = placeholderizeInlineContent($, root);

    const badTranslation = 'Bonjour <x-inline data-id="inline-99">monde</x-inline>.';
    expect(reconstructInlineContent(badTranslation, placeholders)).toBeNull();
  });
});
