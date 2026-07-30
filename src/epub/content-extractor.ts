import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { EpubDocument } from "./epub-reader.js";

export const TRANSLATABLE_BLOCK_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
]);

const NON_TRANSLATABLE_ANCESTOR_TAGS = new Set([
  "script",
  "style",
  "code",
  "pre",
  "svg",
  "math",
]);

export interface ExtractedBlock {
  chapterPath: string;
  /** Stable per-document locator, e.g. "body>div[0]>p[2]". */
  elementLocator: string;
  tagName: string;
  /** Raw inner HTML of the block, inline formatting intact. */
  innerHtml: string;
  /** Plain-text rendering used for language/emptiness checks. */
  textContent: string;
}

function hasNonTranslatableAncestor(
  $: cheerio.CheerioAPI,
  el: Element,
): boolean {
  let current: Element | null = el.parent as Element | null;
  while (current) {
    if (current.type === "tag" && NON_TRANSLATABLE_ANCESTOR_TAGS.has(current.name)) {
      return true;
    }
    current = (current.parent as Element | null) ?? null;
  }
  return false;
}

function isHidden($: cheerio.CheerioAPI, el: Element): boolean {
  const $el = $(el);
  if ($el.attr("hidden") !== undefined) return true;
  const style = $el.attr("style") ?? "";
  if (/display\s*:\s*none/i.test(style)) return true;
  if ($el.attr("aria-hidden") === "true") return true;
  return false;
}

function containsNestedTranslatableBlock(
  $: cheerio.CheerioAPI,
  el: Element,
): boolean {
  let found = false;
  $(el)
    .find("*")
    .each((_, child) => {
      if (child.type === "tag" && TRANSLATABLE_BLOCK_TAGS.has(child.name)) {
        found = true;
      }
    });
  return found;
}

function buildElementLocator($: cheerio.CheerioAPI, el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.type === "tag") {
    const index = $(current).index();
    parts.unshift(`${current.name}[${index}]`);
    current = (current.parent as Element | null) ?? null;
  }
  return parts.join(">");
}

/**
 * Selects leaf translatable elements (p, li, blockquote, figcaption, h1-h6,
 * td, th) from an already-loaded document, in document order. Elements
 * nested inside another translatable block, non-translatable containers
 * (script/style/code/pre/svg/math), hidden elements, or that are empty are
 * excluded. Shared by extractTranslatableBlocks and the bilingual renderer
 * so both walk the exact same elements in the exact same order.
 */
export function selectTranslatableElements($: cheerio.CheerioAPI): Element[] {
  const selector = [...TRANSLATABLE_BLOCK_TAGS].join(",");
  const elements: Element[] = [];

  $(selector).each((_, el) => {
    if (el.type !== "tag") return;
    if (hasNonTranslatableAncestor($, el)) return;
    if (isHidden($, el)) return;
    if (containsNestedTranslatableBlock($, el)) return;
    if ($(el).text().trim().length === 0) return;
    elements.push(el);
  });

  return elements;
}

/**
 * Extracts leaf translatable blocks from a parsed XHTML document, in
 * document order. See selectTranslatableElements for the inclusion rules.
 */
export function extractTranslatableBlocks(
  document: EpubDocument,
): ExtractedBlock[] {
  const $ = cheerio.load(document.content, { xmlMode: true });

  return selectTranslatableElements($).map((el) => ({
    chapterPath: document.path,
    elementLocator: buildElementLocator($, el),
    tagName: el.name,
    innerHtml: $(el).html() ?? "",
    textContent: $(el).text().trim(),
  }));
}
