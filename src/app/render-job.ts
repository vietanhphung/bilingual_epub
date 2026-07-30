import { parseEpub } from "../epub/epub-reader.js";
import { extractTranslatableBlocks } from "../epub/content-extractor.js";
import { segmentBlocks, type DraftSegment } from "../epub/paragraph-segmenter.js";
import {
  renderBilingualEpub,
  resolveSegmentOutcome,
  type SegmentTranslationOutcome,
} from "../epub/bilingual-renderer.js";
import { writeEpub } from "../epub/epub-writer.js";
import { validateTranslationBatch } from "../translation/translation-validator.js";
import type { BookConfig } from "../config/schema.js";
import type {
  TranslationBatchRequest,
  TranslationStrategy,
} from "../domain/translation.js";

export interface TranslateBookResult {
  outputBuffer: Buffer;
  totalSegments: number;
  translatedSegments: number;
  failedSegments: string[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * End-to-end pipeline glue used ahead of the persistence/budget milestones:
 * read -> extract -> segment -> translate (single unbounded batch) ->
 * render -> rebuild. Milestone 6/7 will replace the single-batch call here
 * with the persisted, budget-aware orchestrator without changing the EPUB
 * processing code above it.
 */
export async function translateBookWithStrategy(
  inputBuffer: Buffer,
  config: BookConfig,
  strategy: TranslationStrategy,
): Promise<TranslateBookResult> {
  const parsed = await parseEpub(inputBuffer);

  // Blocks are gathered across all chapters before segmenting once, so
  // orderIndex stays a single monotonic sequence over the whole book
  // (segmenting per-chapter would reset it to 0 at each chapter boundary).
  const blocks = parsed.readingOrderDocuments.flatMap((doc) =>
    extractTranslatableBlocks(doc),
  );
  const allSegments = segmentBlocks(blocks);

  const segmentsByChapter = new Map<string, DraftSegment[]>();
  for (const segment of allSegments) {
    const chapterSegments = segmentsByChapter.get(segment.chapterPath) ?? [];
    chapterSegments.push(segment);
    segmentsByChapter.set(segment.chapterPath, chapterSegments);
  }

  const request: TranslationBatchRequest = {
    segments: allSegments.map((s) => ({
      id: s.id,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      text: s.sourceText,
      protectedPlaceholders: s.placeholders.map(
        (p) => `<x-inline data-id="${p.id}">`,
      ),
    })),
  };

  const translatedTextById = new Map<string, string>();
  const failedSegments: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  if (request.segments.length > 0) {
    const result = await strategy.translateBatch(request);
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;

    const outcome = validateTranslationBatch(request, result);
    for (const [id, text] of outcome.valid) {
      translatedTextById.set(id, text);
    }
    for (const rejected of outcome.rejected) {
      failedSegments.push(rejected.id);
    }
    for (const missingId of outcome.missingIds) {
      failedSegments.push(missingId);
    }
  }

  const outcomesBySegmentId = new Map<string, SegmentTranslationOutcome>();
  for (const segment of allSegments) {
    outcomesBySegmentId.set(
      segment.id,
      resolveSegmentOutcome(segment, translatedTextById.get(segment.id)),
    );
  }

  const entries = renderBilingualEpub(parsed, segmentsByChapter, outcomesBySegmentId, {
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
    displayOrder: config.displayOrder,
  });
  const outputBuffer = await writeEpub(entries);

  return {
    outputBuffer,
    totalSegments: allSegments.length,
    translatedSegments: translatedTextById.size,
    failedSegments,
    inputTokens,
    outputTokens,
  };
}
