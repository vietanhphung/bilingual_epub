import * as cheerio from "cheerio";
import { posix } from "node:path";
import { selectTranslatableElements } from "./content-extractor.js";
import type { EpubDocument, ParsedEpub } from "./epub-reader.js";
import type { DraftSegment } from "./paragraph-segmenter.js";
import { reconstructInlineContent } from "./inline-placeholder.js";
import type { DisplayOrder, SupportedLanguage } from "../domain/translation.js";
import type { WritableEntry } from "./epub-writer.js";

/**
 * Tags that cannot have a sibling <div> take their place in valid XHTML
 * (li/td/th must remain direct children of ul-ol/tr, and figcaption must
 * remain a direct child of figure) get the bilingual pair inserted as new
 * *content* instead of being replaced outright.
 */
const WRAP_INSIDE_TAGS = new Set(["li", "td", "th", "figcaption"]);

export const BILINGUAL_STYLESHEET_CSS = `.bilingual-pair {
  margin: 0 0 1.25em 0;
  break-inside: avoid;
}

.bilingual-pair > [lang="en"],
.bilingual-pair > [lang="fr"] {
  margin-top: 0;
  margin-bottom: 0.4em;
}

.translation-secondary {
  opacity: 0.86;
}
`;

export type SegmentTranslationOutcome =
  | { status: "TRANSLATED"; translatedHtml: string }
  | { status: "FAILED" };

function escapeXhtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildLangElement(
  tagName: string,
  lang: SupportedLanguage,
  innerHtml: string,
  isSecondary: boolean,
): string {
  const classes = [`translation-${lang}`, ...(isSecondary ? ["translation-secondary"] : [])];
  return `<${tagName} class="${classes.join(" ")}" lang="${lang}">${innerHtml}</${tagName}>`;
}

function orderPair(
  sourceLanguage: SupportedLanguage,
  targetLanguage: SupportedLanguage,
  displayOrder: DisplayOrder,
): [SupportedLanguage, SupportedLanguage] {
  const englishFirst = displayOrder === "ENGLISH_FIRST";
  const sourceIsEnglish = sourceLanguage === "en";
  if (englishFirst) {
    return sourceIsEnglish ? [sourceLanguage, targetLanguage] : [targetLanguage, sourceLanguage];
  }
  return sourceIsEnglish ? [targetLanguage, sourceLanguage] : [sourceLanguage, targetLanguage];
}

export interface RenderChapterOptions {
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  displayOrder: DisplayOrder;
  stylesheetHref: string;
}

/**
 * Renders one chapter's bilingual XHTML. `chapterSegments` must be the
 * segments for this chapter in the same order they were originally
 * extracted in (selectTranslatableElements is deterministic, so re-walking
 * the freshly parsed document yields elements in that same order).
 */
export function renderBilingualChapter(
  document: EpubDocument,
  chapterSegments: Array<{ id: string }>,
  outcomes: Map<string, SegmentTranslationOutcome>,
  options: RenderChapterOptions,
): string {
  const $ = cheerio.load(document.content, { xmlMode: true });
  const elements = selectTranslatableElements($);

  if (elements.length !== chapterSegments.length) {
    throw new Error(
      `Segment/element count mismatch in ${document.path}: ${elements.length} elements, ${chapterSegments.length} segments`,
    );
  }

  elements.forEach((el, i) => {
    const segment = chapterSegments[i]!;
    const outcome = outcomes.get(segment.id);
    const $el = $(el);
    const sourceHtml = $el.html() ?? "";

    if (!outcome || outcome.status === "FAILED") {
      return;
    }

    const [firstLang, secondLang] = orderPair(
      options.sourceLanguage,
      options.targetLanguage,
      options.displayOrder,
    );
    const htmlByLang: Record<SupportedLanguage, string> = {
      [options.sourceLanguage]: sourceHtml,
      [options.targetLanguage]: outcome.translatedHtml,
    } as Record<SupportedLanguage, string>;

    const wrapTag = WRAP_INSIDE_TAGS.has(el.name) ? "p" : el.name;
    const first = buildLangElement(wrapTag, firstLang, htmlByLang[firstLang], firstLang === options.targetLanguage);
    const second = buildLangElement(wrapTag, secondLang, htmlByLang[secondLang], secondLang === options.targetLanguage);
    const pairHtml = `<div class="bilingual-pair">${first}${second}</div>`;

    if (WRAP_INSIDE_TAGS.has(el.name)) {
      $el.html(pairHtml);
    } else {
      $el.replaceWith(pairHtml);
    }
  });

  const head = $("head").first();
  if (head.length > 0) {
    head.append(
      `<link rel="stylesheet" type="text/css" href="${escapeXhtml(options.stylesheetHref)}"/>`,
    );
  }

  return $.xml();
}

/**
 * Reconstructs real inline HTML from a translated placeholder string.
 * Falls back to "FAILED" (retain source paragraph) when reconstruction
 * is unsafe, per the "never emit malformed XHTML" rule.
 */
export function resolveSegmentOutcome(
  segment: DraftSegment,
  translatedPlaceholderText: string | undefined,
): SegmentTranslationOutcome {
  if (translatedPlaceholderText === undefined) {
    return { status: "FAILED" };
  }
  const reconstructed = reconstructInlineContent(
    translatedPlaceholderText,
    segment.placeholders,
  );
  if (reconstructed === null) {
    return { status: "FAILED" };
  }
  return { status: "TRANSLATED", translatedHtml: reconstructed };
}

export interface RenderBilingualEpubOptions {
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  displayOrder: DisplayOrder;
}

/**
 * Renders a full bilingual EPUB from a parsed source book: rewrites each
 * reading-order chapter with bilingual-pair markup, adds a dedicated
 * stylesheet (without touching the original CSS), and leaves every other
 * entry (images, nav, existing styles) byte-identical.
 */
export function renderBilingualEpub(
  parsed: ParsedEpub,
  segmentsByChapter: Map<string, Array<{ id: string }>>,
  outcomesBySegmentId: Map<string, SegmentTranslationOutcome>,
  options: RenderBilingualEpubOptions,
): WritableEntry[] {
  const stylesheetPath = posix.join(parsed.opfDir, "styles/bilingual-pairs.css");
  const entries = new Map(parsed.entries);

  for (const document of parsed.readingOrderDocuments) {
    const chapterSegments = segmentsByChapter.get(document.path) ?? [];
    const outcomes = new Map<string, SegmentTranslationOutcome>();
    for (const segment of chapterSegments) {
      outcomes.set(
        segment.id,
        outcomesBySegmentId.get(segment.id) ?? { status: "FAILED" },
      );
    }

    const stylesheetHref = posix.relative(posix.dirname(document.path), stylesheetPath);
    const rendered = renderBilingualChapter(document, chapterSegments, outcomes, {
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      displayOrder: options.displayOrder,
      stylesheetHref,
    });
    entries.set(document.path, Buffer.from(rendered, "utf-8"));
  }

  entries.set(stylesheetPath, Buffer.from(BILINGUAL_STYLESHEET_CSS, "utf-8"));

  const opfBuffer = entries.get(parsed.opfPath);
  if (!opfBuffer) {
    throw new Error(`OPF package document missing at ${parsed.opfPath}`);
  }
  const $opf = cheerio.load(opfBuffer.toString("utf-8"), { xmlMode: true });
  const cssHrefInManifest = posix.relative(parsed.opfDir, stylesheetPath);
  $opf("manifest").append(
    `<item id="bilingual-pairs-css" href="${escapeXhtml(cssHrefInManifest)}" media-type="text/css"/>`,
  );
  entries.set(parsed.opfPath, Buffer.from($opf.xml(), "utf-8"));

  const newPaths = [...entries.keys()].filter((p) => !parsed.entryOrder.includes(p));
  const order = [...parsed.entryOrder, ...newPaths];

  return order.map((path) => ({ path, data: entries.get(path)! }));
}
