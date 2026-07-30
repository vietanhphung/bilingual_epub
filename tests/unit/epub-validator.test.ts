import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { validateEpub } from "../../src/epub/epub-validator.js";
import {
  buildEpubBuffer,
  buildOpf,
  buildSimpleFixtureEpub,
} from "../fixtures/build-epub.js";

function buildRawZip(
  entries: Array<{ path: string; content: string; compress: boolean }>,
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    for (const entry of entries) {
      zipfile.addBuffer(Buffer.from(entry.content), entry.path, {
        compress: entry.compress,
        mtime: new Date(0),
        mode: 0o100644,
      });
    }
    zipfile.outputStream.on("data", (c: Buffer) => chunks.push(c));
    zipfile.outputStream.on("end", () => resolvePromise(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
    zipfile.end();
  });
}

describe("validateEpub", () => {
  it("passes a well-formed fixture EPUB", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const result = await validateEpub(buffer);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("flags a compressed mimetype entry", async () => {
    const buffer = await buildRawZip([
      { path: "mimetype", content: "application/epub+zip", compress: true },
      {
        path: "META-INF/container.xml",
        content:
          '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        compress: true,
      },
      {
        path: "OEBPS/content.opf",
        content: buildOpf([], []),
        compress: true,
      },
    ]);

    const result = await validateEpub(buffer);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("MIMETYPE_COMPRESSED");
  });

  it("flags a manifest item whose file is missing", async () => {
    const buffer = await buildEpubBuffer([
      { path: "mimetype", content: "application/epub+zip" },
      {
        path: "META-INF/container.xml",
        content:
          '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      },
      {
        path: "OEBPS/content.opf",
        content: buildOpf(
          [{ id: "ch1", href: "text/missing.xhtml", mediaType: "application/xhtml+xml" }],
          ["ch1"],
        ),
      },
    ]);

    const result = await validateEpub(buffer);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("MANIFEST_FILE_MISSING");
  });

  it("flags malformed XHTML content", async () => {
    const buffer = await buildEpubBuffer([
      { path: "mimetype", content: "application/epub+zip" },
      {
        path: "META-INF/container.xml",
        content:
          '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      },
      {
        path: "OEBPS/content.opf",
        content: buildOpf(
          [{ id: "ch1", href: "text/broken.xhtml", mediaType: "application/xhtml+xml" }],
          ["ch1"],
        ),
      },
      { path: "OEBPS/text/broken.xhtml", content: "<html><body><p>Oops</body></html>" },
    ]);

    const result = await validateEpub(buffer);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("XHTML_NOT_WELL_FORMED");
  });

  it("flags an internal link to a file that doesn't exist", async () => {
    const buffer = await buildEpubBuffer([
      { path: "mimetype", content: "application/epub+zip" },
      {
        path: "META-INF/container.xml",
        content:
          '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      },
      {
        path: "OEBPS/content.opf",
        content: buildOpf(
          [{ id: "ch1", href: "text/ch1.xhtml", mediaType: "application/xhtml+xml" }],
          ["ch1"],
        ),
      },
      {
        path: "OEBPS/text/ch1.xhtml",
        content: '<html><body><p><a href="nowhere.xhtml">gone</a></p></body></html>',
      },
    ]);

    const result = await validateEpub(buffer);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("UNRESOLVED_LINK");
  });
});
