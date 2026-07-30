import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { createHash } from "node:crypto";
import type { ExtractedBlock } from "./content-extractor.js";
import {
  placeholderizeInlineContent,
  type InlinePlaceholder,
} from "./inline-placeholder.js";

export interface DraftSegment {
  id: string;
  chapterPath: string;
  elementLocator: string;
  tagName: string;
  /** Global position across the whole book, in spine/document order. */
  orderIndex: number;
  /** Plain text with <x-inline> placeholder markers, sent for translation. */
  sourceText: string;
  /** Original inner HTML of the source element, used for rendering fallback. */
  sourceHtml: string;
  sourceChecksum: string;
  placeholders: InlinePlaceholder[];
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().normalize("NFC");
}

function slugifyChapterPath(path: string): string {
  return (
    path
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "chapter"
  );
}

/**
 * Deterministic across runs: depends only on the chapter file, this
 * element's position within that chapter, and a checksum of its
 * normalized text — never on wall-clock time or insertion order elsewhere.
 */
export function computeSegmentId(
  chapterPath: string,
  chapterLocalIndex: number,
  normalizedText: string,
): string {
  const checksum = createHash("sha256").update(normalizedText).digest("hex");
  const slug = slugifyChapterPath(chapterPath);
  const position = String(chapterLocalIndex).padStart(4, "0");
  return `${slug}-p${position}-${checksum.slice(0, 10)}`;
}

/**
 * Turns extracted blocks (already in book reading order) into paragraph
 * segments: computes inline placeholders, a normalized-text checksum, and
 * a deterministic ID for each. One block maps to exactly one segment
 * (PARAGRAPH granularity — see UnsupportedGranularityError elsewhere for
 * anything else).
 */
export function segmentBlocks(blocks: ExtractedBlock[]): DraftSegment[] {
  const chapterCounters = new Map<string, number>();

  return blocks.map((block, globalIndex) => {
    const chapterLocalIndex = (chapterCounters.get(block.chapterPath) ?? 0) + 1;
    chapterCounters.set(block.chapterPath, chapterLocalIndex);

    const $ = cheerio.load(`<x-root>${block.innerHtml}</x-root>`, {
      xmlMode: true,
    });
    const root = $("x-root")[0] as Element;
    const { text: sourceText, placeholders } = placeholderizeInlineContent(
      $,
      root,
    );

    const normalizedText = normalizeText(block.textContent);
    const sourceChecksum = createHash("sha256")
      .update(normalizedText)
      .digest("hex");
    const id = computeSegmentId(block.chapterPath, chapterLocalIndex, normalizedText);

    return {
      id,
      chapterPath: block.chapterPath,
      elementLocator: block.elementLocator,
      tagName: block.tagName,
      orderIndex: globalIndex,
      sourceText,
      sourceHtml: block.innerHtml,
      sourceChecksum,
      placeholders,
    };
  });
}
