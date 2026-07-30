import { describe, expect, it } from "vitest";
import { extractTranslatableBlocks } from "../../src/epub/content-extractor.js";
import { segmentBlocks } from "../../src/epub/paragraph-segmenter.js";

const CONTENT = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <p>First paragraph.</p>
  <p>Second paragraph with <em>emphasis</em>.</p>
</body></html>`;

describe("segmentBlocks", () => {
  it("produces one segment per translatable block with sequential order", () => {
    const blocks = extractTranslatableBlocks({ path: "OEBPS/text/ch1.xhtml", content: CONTENT });
    const segments = segmentBlocks(blocks);

    expect(segments).toHaveLength(2);
    expect(segments[0]!.orderIndex).toBe(0);
    expect(segments[1]!.orderIndex).toBe(1);
    expect(segments[1]!.sourceText).toContain('<x-inline data-id="inline-1">emphasis</x-inline>');
  });

  it("produces deterministic, stable IDs across repeated runs", () => {
    const blocks = extractTranslatableBlocks({ path: "OEBPS/text/ch1.xhtml", content: CONTENT });
    const first = segmentBlocks(blocks);
    const second = segmentBlocks(blocks);

    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
  });

  it("produces different IDs for different chapters with identical text", () => {
    const blocksA = extractTranslatableBlocks({ path: "OEBPS/text/ch1.xhtml", content: "<p>Same text.</p>" });
    const blocksB = extractTranslatableBlocks({ path: "OEBPS/text/ch2.xhtml", content: "<p>Same text.</p>" });

    const segA = segmentBlocks(blocksA)[0]!;
    const segB = segmentBlocks(blocksB)[0]!;
    expect(segA.id).not.toBe(segB.id);
  });

  it("changes the ID when the source text changes but position is the same", () => {
    const blocksA = extractTranslatableBlocks({ path: "ch1.xhtml", content: "<p>Version A.</p>" });
    const blocksB = extractTranslatableBlocks({ path: "ch1.xhtml", content: "<p>Version B.</p>" });

    const segA = segmentBlocks(blocksA)[0]!;
    const segB = segmentBlocks(blocksB)[0]!;
    expect(segA.id).not.toBe(segB.id);
  });
});
