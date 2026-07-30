import yazl from "yazl";
import { crc32 } from "node:zlib";

export interface FixtureFile {
  path: string;
  content: string | Buffer;
  compress?: boolean;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export interface OpfManifestEntry {
  id: string;
  href: string;
  mediaType: string;
}

export function buildOpf(
  manifest: OpfManifestEntry[],
  spineIds: string[],
): string {
  const manifestXml = manifest
    .map(
      (m) =>
        `    <item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"/>`,
    )
    .join("\n");
  const spineXml = spineIds
    .map((id) => `    <itemref idref="${id}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test-fixture</dc:identifier>
    <dc:title>Fixture Book</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
${manifestXml}
  </manifest>
  <spine>
${spineXml}
  </spine>
</package>
`;
}

/**
 * Builds a raw EPUB zip buffer from a list of files. Always writes
 * "mimetype" first, uncompressed, regardless of its position in `files`.
 */
export function buildEpubBuffer(files: FixtureFile[]): Promise<Buffer> {
  const mimetype = files.find((f) => f.path === "mimetype");
  const rest = files.filter((f) => f.path !== "mimetype");

  return new Promise((resolvePromise, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];

    zipfile.addBuffer(
      Buffer.from(mimetype ? mimetype.content : "application/epub+zip"),
      "mimetype",
      { compress: false, mtime: new Date(0), mode: 0o100644 },
    );

    for (const file of rest) {
      const data =
        typeof file.content === "string"
          ? Buffer.from(file.content, "utf-8")
          : file.content;
      zipfile.addBuffer(data, file.path, {
        compress: file.compress ?? true,
        mtime: new Date(0),
        mode: 0o100644,
      });
    }

    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolvePromise(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", (err: Error) => reject(err));
    zipfile.end();
  });
}

const STYLESHEET_CSS = `body { font-family: serif; }\n`;

/** A minimal but structurally complete EPUB covering common content shapes. */
export async function buildSimpleFixtureEpub(): Promise<Buffer> {
  const chapter1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title><link rel="stylesheet" href="../styles/style.css"/></head>
<body>
  <h1>Chapter One</h1>
  <p>It was still dark when she left the house.</p>
  <p>Il regarda <em>la mer</em> pendant plusieurs minutes.</p>
  <ul>
    <li>First item</li>
    <li>Second item</li>
  </ul>
  <blockquote><p>A quoted thought.</p></blockquote>
  <figure>
    <img src="../images/cover.png" alt="A picture"/>
    <figcaption>A caption describing the picture.</figcaption>
  </figure>
  <p>See <a href="chapter2.xhtml">chapter two</a> for more<a id="fn1ref" href="#fn1"><sup>1</sup></a>.</p>
  <aside id="fn1"><p>This is a footnote.</p></aside>
</body>
</html>`;

  const chapter2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 2</title></head>
<body>
  <h1>Chapter Two</h1>
  <p>${"This is a very long paragraph. ".repeat(60)}</p>
</body>
</html>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Nav</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="text/chapter1.xhtml">Chapter One</a></li>
      <li><a href="text/chapter2.xhtml">Chapter Two</a></li>
    </ol>
  </nav>
</body>
</html>`;

  const manifest: OpfManifestEntry[] = [
    { id: "chapter1", href: "text/chapter1.xhtml", mediaType: "application/xhtml+xml" },
    { id: "chapter2", href: "text/chapter2.xhtml", mediaType: "application/xhtml+xml" },
    { id: "nav", href: "nav.xhtml", mediaType: "application/xhtml+xml" },
    { id: "style", href: "styles/style.css", mediaType: "text/css" },
    { id: "cover-img", href: "images/cover.png", mediaType: "image/png" },
  ];

  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  return buildEpubBuffer([
    { path: "mimetype", content: "application/epub+zip" },
    {
      path: "META-INF/container.xml",
      content: CONTAINER_XML,
    },
    {
      path: "OEBPS/content.opf",
      content: buildOpf(manifest, ["chapter1", "chapter2"]),
    },
    { path: "OEBPS/nav.xhtml", content: nav },
    { path: "OEBPS/text/chapter1.xhtml", content: chapter1 },
    { path: "OEBPS/text/chapter2.xhtml", content: chapter2 },
    { path: "OEBPS/styles/style.css", content: STYLESHEET_CSS },
    { path: "OEBPS/images/cover.png", content: tinyPng, compress: false },
  ]);
}

/**
 * Hand-rolled STORE-only zip writer that skips path validation, so tests
 * can construct archives a well-behaved zip library would refuse to write
 * (path traversal, absolute paths) in order to exercise safeExtract's own
 * defenses against a maliciously crafted EPUB.
 */
function buildUnsafeRawZip(files: Array<{ path: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.path, "utf-8");
    const dataBuf = Buffer.from(file.content, "utf-8");
    const crc = crc32(dataBuf) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

export function buildPathTraversalEpub(): Buffer {
  return buildUnsafeRawZip([
    { path: "mimetype", content: "application/epub+zip" },
    { path: "META-INF/container.xml", content: CONTAINER_XML },
    {
      path: "OEBPS/content.opf",
      content: buildOpf(
        [{ id: "chapter1", href: "text/chapter1.xhtml", mediaType: "application/xhtml+xml" }],
        ["chapter1"],
      ),
    },
    { path: "OEBPS/text/chapter1.xhtml", content: "<html><body><p>Hi</p></body></html>" },
    { path: "../../etc/evil.txt", content: "pwned" },
  ]);
}
