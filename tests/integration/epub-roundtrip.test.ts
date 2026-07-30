import { describe, expect, it } from "vitest";
import { parseEpub } from "../../src/epub/epub-reader.js";
import { writeEpub, type WritableEntry } from "../../src/epub/epub-writer.js";
import { validateEpub } from "../../src/epub/epub-validator.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";

describe("EPUB round trip", () => {
  it("rebuilds an unchanged EPUB without losing chapters, images, CSS, nav, or links", async () => {
    const original = await buildSimpleFixtureEpub();
    const parsed = await parseEpub(original);

    const entries: WritableEntry[] = parsed.entryOrder.map((path) => ({
      path,
      data: parsed.entries.get(path)!,
    }));
    const rebuilt = await writeEpub(entries);

    const reparsed = await parseEpub(rebuilt);
    expect(reparsed.manifest.length).toBe(parsed.manifest.length);
    expect(reparsed.spine).toEqual(parsed.spine);
    expect(reparsed.readingOrderDocuments).toEqual(parsed.readingOrderDocuments);

    // Non-XHTML assets (image, stylesheet) must be byte-identical.
    expect(reparsed.entries.get("OEBPS/images/cover.png")).toEqual(
      parsed.entries.get("OEBPS/images/cover.png"),
    );
    expect(reparsed.entries.get("OEBPS/styles/style.css")).toEqual(
      parsed.entries.get("OEBPS/styles/style.css"),
    );
    expect(reparsed.entries.get("OEBPS/nav.xhtml")).toEqual(
      parsed.entries.get("OEBPS/nav.xhtml"),
    );

    // Internal link and footnote markup survive untouched.
    const chapter1 = reparsed.readingOrderDocuments[0]!.content;
    expect(chapter1).toContain('href="chapter2.xhtml"');
    expect(chapter1).toContain('href="#fn1"');
  });

  it("produces output that passes structural validation", async () => {
    const original = await buildSimpleFixtureEpub();
    const parsed = await parseEpub(original);
    const entries: WritableEntry[] = parsed.entryOrder.map((path) => ({
      path,
      data: parsed.entries.get(path)!,
    }));
    const rebuilt = await writeEpub(entries);

    const result = await validateEpub(rebuilt);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
