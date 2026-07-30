import { describe, expect, it } from "vitest";
import { parseEpub } from "../../src/epub/epub-reader.js";
import { InvalidEpubError } from "../../src/domain/errors.js";
import { buildSimpleFixtureEpub } from "../fixtures/build-epub.js";

describe("parseEpub", () => {
  it("resolves container.xml, OPF manifest, and spine in reading order", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const parsed = await parseEpub(buffer);

    expect(parsed.opfPath).toBe("OEBPS/content.opf");
    expect(parsed.manifest.map((m) => m.id).sort()).toEqual(
      ["chapter1", "chapter2", "cover-img", "nav", "style"].sort(),
    );
    expect(parsed.spine.map((s) => s.idref)).toEqual(["chapter1", "chapter2"]);
    expect(parsed.readingOrderDocuments.map((d) => d.path)).toEqual([
      "OEBPS/text/chapter1.xhtml",
      "OEBPS/text/chapter2.xhtml",
    ]);
    expect(parsed.readingOrderDocuments[0]!.content).toContain("It was still dark");
  });

  it("computes a stable sha-256 checksum of the input", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const first = await parseEpub(buffer);
    const second = await parseEpub(buffer);
    expect(first.inputChecksum).toBe(second.inputChecksum);
    expect(first.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a buffer without a valid mimetype entry", async () => {
    const notAnEpub = Buffer.from("PK\x03\x04not a real zip");
    await expect(parseEpub(notAnEpub)).rejects.toThrow(InvalidEpubError);
  });
});
