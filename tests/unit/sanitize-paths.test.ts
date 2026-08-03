import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { sanitizeArchivePath, sanitizeEpubEntryPaths } from "../../src/epub/sanitize-paths.js";
import type { WritableEntry } from "../../src/epub/epub-writer.js";

function text(entries: WritableEntry[], path: string): string {
  const entry = entries.find((e) => e.path === path);
  if (!entry) throw new Error(`missing entry: ${path}`);
  return entry.data.toString("utf-8");
}

describe("sanitizeArchivePath", () => {
  it("leaves already-safe paths untouched", () => {
    expect(sanitizeArchivePath("OEBPS/text/chapter1.xhtml")).toBe("OEBPS/text/chapter1.xhtml");
  });

  it("strips brackets, commas, apostrophes, parens, and spaces per segment", () => {
    expect(sanitizeArchivePath("Rowling,J.K.-[Harry Potter-1] a l'Ecole(1997).html")).toBe(
      "Rowling_J.K.-_Harry_Potter-1_a_l_Ecole_1997.html",
    );
  });

  it("preserves the file extension and directory structure", () => {
    expect(sanitizeArchivePath("OEBPS/text/chap ter (1).xhtml")).toBe(
      "OEBPS/text/chap_ter_1.xhtml",
    );
  });
});

describe("sanitizeEpubEntryPaths", () => {
  const containerXml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opfXml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">T</dc:title></metadata>
  <manifest>
    <item id="c1" href="Book Title (v1),final.html" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.html" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

  const ncxXml = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>One</text></navLabel>
      <content src="Book Title (v1),final.html"/>
    </navPoint>
  </navMap>
</ncx>`;

  const chapter1Html = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><link href="style.css" rel="stylesheet" type="text/css"/></head>
<body><p><a href="chapter2.html#next">Next</a></p></body></html>`;

  const chapter2Html = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head></head>
<body><p id="next"><a href="Book Title (v1),final.html">Back</a></p></body></html>`;

  function buildEntries(): WritableEntry[] {
    return [
      { path: "mimetype", data: Buffer.from("application/epub+zip") },
      { path: "META-INF/container.xml", data: Buffer.from(containerXml) },
      { path: "content.opf", data: Buffer.from(opfXml) },
      { path: "toc.ncx", data: Buffer.from(ncxXml) },
      { path: "Book Title (v1),final.html", data: Buffer.from(chapter1Html) },
      { path: "chapter2.html", data: Buffer.from(chapter2Html) },
      { path: "style.css", data: Buffer.from(".x{}") },
    ];
  }

  it("is a no-op when every path is already safe", () => {
    const entries: WritableEntry[] = [
      { path: "mimetype", data: Buffer.from("x") },
      { path: "OEBPS/chapter1.xhtml", data: Buffer.from("<html/>") },
    ];
    expect(sanitizeEpubEntryPaths(entries)).toBe(entries);
  });

  it("renames unsafe paths and rewrites every reference to them", () => {
    const result = sanitizeEpubEntryPaths(buildEntries());
    const paths = result.map((e) => e.path);

    expect(paths).not.toContain("Book Title (v1),final.html");
    const renamed = paths.find((p) => p !== "mimetype" && p.includes("Book_Title"));
    expect(renamed).toBeDefined();
    expect(renamed).toMatch(/^Book_Title.*\.html$/);

    // container.xml points at the (already-safe) opf path, unaffected
    const container$ = cheerio.load(text(result, "META-INF/container.xml"), { xmlMode: true });
    expect(container$("rootfile").attr("full-path")).toBe("content.opf");

    // OPF manifest item href follows the rename
    const opf$ = cheerio.load(text(result, "content.opf"), { xmlMode: true });
    expect(opf$("item#c1").attr("href")).toBe(renamed);

    // NCX content src follows the rename
    const ncx$ = cheerio.load(text(result, "toc.ncx"), { xmlMode: true });
    expect(ncx$("content").attr("src")).toBe(renamed);

    // chapter2 -> chapter1 link (safe path referencing an unsafe one) follows the rename
    const chapter2$ = cheerio.load(text(result, "chapter2.html"), { xmlMode: true });
    expect(chapter2$("a").attr("href")).toBe(renamed);

    // chapter1 -> chapter2 link (unsafe path referencing a safe one) is untouched, fragment preserved
    const chapter1$ = cheerio.load(text(result, renamed!), { xmlMode: true });
    expect(chapter1$("a").attr("href")).toBe("chapter2.html#next");

    // stylesheet link inside the renamed chapter is untouched (style.css already safe)
    expect(chapter1$("link").attr("href")).toBe("style.css");
  });

  it("de-duplicates when two unsafe paths sanitize to the same name", () => {
    const entries: WritableEntry[] = [
      { path: "mimetype", data: Buffer.from("x") },
      { path: "chap (1).html", data: Buffer.from("<html/>") },
      { path: "chap [1].html", data: Buffer.from("<html/>") },
    ];
    const result = sanitizeEpubEntryPaths(entries);
    const paths = result.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("chap_1.html");
    expect(paths).toContain("chap_1-2.html");
  });
});
