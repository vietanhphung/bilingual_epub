import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { translateBookWithStrategy } from "../../src/app/render-job.js";
import { MockTranslationStrategy } from "../../src/translation/providers/mock-translation-strategy.js";
import { inspectBook } from "../../src/app/inspect-book.js";
import { parseEpub } from "../../src/epub/epub-reader.js";
import { validateEpub } from "../../src/epub/epub-validator.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";
import type { BookConfig } from "../../src/config/schema.js";

describe("mock bilingual rendering (Milestone 4)", () => {
  it("contains one bilingual pair for each source paragraph and passes structural validation", async () => {
    const input = await buildSimpleFixtureEpub();
    const { paragraphCount } = await inspectBook(input);

    const config: BookConfig = {
      sourceLanguage: "fr",
      targetLanguage: "en",
      displayOrder: "ENGLISH_FIRST",
      granularity: "PARAGRAPH",
    };
    const strategy = new MockTranslationStrategy();
    const result = await translateBookWithStrategy(input, config, strategy);

    expect(result.totalSegments).toBe(paragraphCount);
    expect(result.translatedSegments).toBe(paragraphCount);
    expect(result.failedSegments).toEqual([]);

    const validation = await validateEpub(result.outputBuffer);
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);

    const parsed = await parseEpub(result.outputBuffer);
    let pairCount = 0;
    for (const doc of parsed.readingOrderDocuments) {
      const $ = cheerio.load(doc.content, { xmlMode: true });
      pairCount += $(".bilingual-pair").length;
    }
    expect(pairCount).toBe(paragraphCount);
  });

  it("respects ENGLISH_FIRST vs FRENCH_FIRST document order", async () => {
    const input = await buildSimpleFixtureEpub();
    const strategy = new MockTranslationStrategy();

    const englishFirst = await translateBookWithStrategy(
      input,
      { sourceLanguage: "fr", targetLanguage: "en", displayOrder: "ENGLISH_FIRST", granularity: "PARAGRAPH" },
      strategy,
    );
    const frenchFirst = await translateBookWithStrategy(
      input,
      { sourceLanguage: "fr", targetLanguage: "en", displayOrder: "FRENCH_FIRST", granularity: "PARAGRAPH" },
      strategy,
    );

    const parsedEn = await parseEpub(englishFirst.outputBuffer);
    const $en = cheerio.load(parsedEn.readingOrderDocuments[0]!.content, { xmlMode: true });
    const langsEn = $en(".bilingual-pair").first().children().map((_, el) => $en(el).attr("lang")).get();
    expect(langsEn).toEqual(["en", "fr"]);

    const parsedFr = await parseEpub(frenchFirst.outputBuffer);
    const $fr = cheerio.load(parsedFr.readingOrderDocuments[0]!.content, { xmlMode: true });
    const langsFr = $fr(".bilingual-pair").first().children().map((_, el) => $fr(el).attr("lang")).get();
    expect(langsFr).toEqual(["fr", "en"]);
  });

  it("preserves images and internal links alongside translated text", async () => {
    const input = await buildSimpleFixtureEpub();
    const strategy = new MockTranslationStrategy();
    const result = await translateBookWithStrategy(
      input,
      { sourceLanguage: "fr", targetLanguage: "en", displayOrder: "ENGLISH_FIRST", granularity: "PARAGRAPH" },
      strategy,
    );

    const parsed = await parseEpub(result.outputBuffer);
    expect(parsed.entries.get("OEBPS/images/cover.png")).toBeDefined();
    const chapter1 = parsed.readingOrderDocuments[0]!.content;
    expect(chapter1).toContain('href="chapter2.xhtml"');
    expect(chapter1).toContain('href="#fn1"');
    expect(chapter1).toContain("styles/bilingual-pairs.css");
  });

  it("injects a dedicated stylesheet without replacing the original CSS", async () => {
    const input = await buildSimpleFixtureEpub();
    const strategy = new MockTranslationStrategy();
    const result = await translateBookWithStrategy(
      input,
      { sourceLanguage: "fr", targetLanguage: "en", displayOrder: "ENGLISH_FIRST", granularity: "PARAGRAPH" },
      strategy,
    );

    const parsed = await parseEpub(result.outputBuffer);
    expect(parsed.entries.get("OEBPS/styles/style.css")?.toString("utf-8")).toContain("font-family: serif");
    expect(parsed.entries.get("OEBPS/styles/bilingual-pairs.css")?.toString("utf-8")).toContain(
      "bilingual-pair",
    );
  });
});
