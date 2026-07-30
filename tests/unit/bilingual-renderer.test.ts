import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { extractTranslatableBlocks } from "../../src/epub/content-extractor.js";
import { segmentBlocks } from "../../src/epub/paragraph-segmenter.js";
import {
  renderBilingualChapter,
  resolveSegmentOutcome,
  type SegmentTranslationOutcome,
} from "../../src/epub/bilingual-renderer.js";

function renderFixture(
  content: string,
  displayOrder: "ENGLISH_FIRST" | "FRENCH_FIRST",
  translations: Record<string, string>,
) {
  const document = { path: "ch1.xhtml", content };
  const blocks = extractTranslatableBlocks(document);
  const segments = segmentBlocks(blocks);

  const outcomes = new Map<string, SegmentTranslationOutcome>();
  for (const segment of segments) {
    outcomes.set(
      segment.id,
      resolveSegmentOutcome(segment, translations[segment.id]),
    );
  }

  const html = renderBilingualChapter(document, segments, outcomes, {
    sourceLanguage: "fr",
    targetLanguage: "en",
    displayOrder,
    stylesheetHref: "../styles/bilingual-pairs.css",
  });
  return { html, segments };
}

describe("renderBilingualChapter", () => {
  it("produces one bilingual-pair per source paragraph with ENGLISH_FIRST order", () => {
    const content = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>Bonjour.</p></body></html>`;
    const { html, segments } = renderFixture(content, "ENGLISH_FIRST", {
      [segmentsIdOf(content)]: "[EN] Bonjour.",
    });
    const $ = cheerio.load(html, { xmlMode: true });
    expect($(".bilingual-pair")).toHaveLength(1);
    const langs = $(".bilingual-pair > *").map((_, el) => $(el).attr("lang")).get();
    expect(langs).toEqual(["en", "fr"]);
    expect(segments).toHaveLength(1);
  });

  it("produces FRENCH_FIRST order when configured", () => {
    const content = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>Bonjour.</p></body></html>`;
    const segId = segmentsIdOf(content);
    const { html } = renderFixture(content, "FRENCH_FIRST", {
      [segId]: "[EN] Bonjour.",
    });
    const $ = cheerio.load(html, { xmlMode: true });
    const langs = $(".bilingual-pair > *").map((_, el) => $(el).attr("lang")).get();
    expect(langs).toEqual(["fr", "en"]);
  });

  it("keeps li/td/th/figcaption as the outer element and nests the pair inside", () => {
    const content = `<html xmlns="http://www.w3.org/1999/xhtml"><body><ul><li>Bonjour.</li></ul></body></html>`;
    const segId = segmentsIdOf(content);
    const { html } = renderFixture(content, "ENGLISH_FIRST", {
      [segId]: "[EN] Bonjour.",
    });
    const $ = cheerio.load(html, { xmlMode: true });
    expect($("li").length).toBe(1);
    expect($("li > .bilingual-pair").length).toBe(1);
    expect($("li > .bilingual-pair > p")).toHaveLength(2);
  });

  it("retains the original source paragraph when translation is missing (failed segment)", () => {
    const content = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Bonjour tout le monde.</p></body></html>`;
    const { html } = renderFixture(content, "ENGLISH_FIRST", {});
    const $ = cheerio.load(html, { xmlMode: true });
    expect($(".bilingual-pair")).toHaveLength(0);
    expect($("p").text()).toBe("Bonjour tout le monde.");
  });

  it("injects a stylesheet link into the document head", () => {
    const content = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>Bonjour.</p></body></html>`;
    const segId = segmentsIdOf(content);
    const { html } = renderFixture(content, "ENGLISH_FIRST", {
      [segId]: "[EN] Bonjour.",
    });
    expect(html).toContain('href="../styles/bilingual-pairs.css"');
  });
});

function segmentsIdOf(content: string): string {
  const blocks = extractTranslatableBlocks({ path: "ch1.xhtml", content });
  return segmentBlocks(blocks)[0]!.id;
}
