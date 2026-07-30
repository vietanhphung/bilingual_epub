import { parseEpub } from "../epub/epub-reader.js";
import { extractTranslatableBlocks } from "../epub/content-extractor.js";
import { segmentBlocks, type DraftSegment } from "../epub/paragraph-segmenter.js";

export interface InspectionReport {
  inputChecksum: string;
  chapterCount: number;
  paragraphCount: number;
  paragraphsByChapter: Record<string, number>;
  segments: DraftSegment[];
}

/**
 * Reads and segments a book without making any translation calls — the
 * token-independent report backing `inspect` and the basis for `estimate`.
 */
export async function inspectBook(buffer: Buffer): Promise<InspectionReport> {
  const parsed = await parseEpub(buffer);
  const blocks = parsed.readingOrderDocuments.flatMap((doc) =>
    extractTranslatableBlocks(doc),
  );
  const segments = segmentBlocks(blocks);

  const paragraphsByChapter: Record<string, number> = {};
  for (const segment of segments) {
    paragraphsByChapter[segment.chapterPath] =
      (paragraphsByChapter[segment.chapterPath] ?? 0) + 1;
  }

  return {
    inputChecksum: parsed.inputChecksum,
    chapterCount: parsed.readingOrderDocuments.length,
    paragraphCount: segments.length,
    paragraphsByChapter,
    segments,
  };
}
