import * as cheerio from "cheerio";
import { posix } from "node:path";
import { createHash } from "node:crypto";
import {
  InvalidEpubError,
  ManifestResolutionError,
} from "../domain/errors.js";
import {
  safeExtract,
  type ArchiveEntry,
  type ArchiveLimits,
} from "./safe-archive.js";

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

export interface SpineItemRef {
  idref: string;
  linear: boolean;
}

export interface EpubDocument {
  /** Zip-relative path, e.g. "OEBPS/text/chapter1.xhtml" */
  path: string;
  content: string;
}

export interface ParsedEpub {
  inputChecksum: string;
  entries: Map<string, Buffer>;
  entryOrder: string[];
  opfPath: string;
  opfDir: string;
  manifest: ManifestItem[];
  spine: SpineItemRef[];
  /** XHTML documents in spine reading order (linear items only). */
  readingOrderDocuments: EpubDocument[];
}

function resolveRelative(baseDir: string, href: string): string {
  const cleanHref = href.split("#")[0]!;
  const resolved = posix.normalize(posix.join(baseDir, cleanHref));
  if (resolved.startsWith("..")) {
    throw new ManifestResolutionError(
      `Manifest href escapes the archive: ${href}`,
    );
  }
  return resolved;
}

function getEntryText(
  entries: Map<string, Buffer>,
  path: string,
  context: string,
): string {
  const buf = entries.get(path);
  if (!buf) {
    throw new ManifestResolutionError(`${context} not found: ${path}`);
  }
  return buf.toString("utf-8");
}

export function parseContainer(entries: Map<string, Buffer>): string {
  const containerPath = "META-INF/container.xml";
  const xml = getEntryText(entries, containerPath, "container.xml");
  const $ = cheerio.load(xml, { xmlMode: true });
  const rootfile = $("rootfile").first();
  const fullPath = rootfile.attr("full-path");
  if (!fullPath) {
    throw new InvalidEpubError(
      "container.xml does not declare a rootfile full-path",
    );
  }
  return fullPath;
}

export function parseOpf(
  entries: Map<string, Buffer>,
  opfPath: string,
): { manifest: ManifestItem[]; spine: SpineItemRef[] } {
  const opfDir = posix.dirname(opfPath);
  const xml = getEntryText(entries, opfPath, "OPF package document");
  const $ = cheerio.load(xml, { xmlMode: true });

  const manifest: ManifestItem[] = [];
  $("manifest > item").each((_, el) => {
    const id = $(el).attr("id");
    const href = $(el).attr("href");
    const mediaType = $(el).attr("media-type");
    if (!id || !href || !mediaType) {
      throw new ManifestResolutionError(
        "Manifest item is missing id, href, or media-type",
      );
    }
    manifest.push({
      id,
      href: resolveRelative(opfDir, href),
      mediaType,
    });
  });

  const spine: SpineItemRef[] = [];
  $("spine > itemref").each((_, el) => {
    const idref = $(el).attr("idref");
    if (!idref) {
      throw new ManifestResolutionError("Spine itemref is missing idref");
    }
    const linear = $(el).attr("linear") !== "no";
    spine.push({ idref, linear });
  });

  return { manifest, spine };
}

export interface ParseEpubOptions {
  archiveLimits?: ArchiveLimits;
}

export async function parseEpub(
  buffer: Buffer,
  options: ParseEpubOptions = {},
): Promise<ParsedEpub> {
  if (
    buffer.byteLength < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b
  ) {
    throw new InvalidEpubError("File is not a zip/EPUB archive");
  }

  const { entries: rawEntries, entryOrder } = await safeExtract(
    buffer,
    options.archiveLimits,
  );

  const mimetypeEntry = rawEntries.find((e) => e.path === "mimetype");
  if (!mimetypeEntry) {
    throw new InvalidEpubError("EPUB is missing the mimetype entry");
  }
  if (mimetypeEntry.data.toString("utf-8").trim() !== "application/epub+zip") {
    throw new InvalidEpubError(
      "mimetype entry does not contain application/epub+zip",
    );
  }
  if (entryOrder[0] !== "mimetype") {
    throw new InvalidEpubError("mimetype must be the first entry in the archive");
  }

  const entries = new Map(rawEntries.map((e) => [e.path, e.data]));

  const opfPath = parseContainer(entries);
  const { manifest, spine } = parseOpf(entries, opfPath);
  const opfDir = posix.dirname(opfPath);

  const manifestById = new Map(manifest.map((m) => [m.id, m]));
  const readingOrderDocuments: EpubDocument[] = [];
  for (const ref of spine) {
    if (!ref.linear) continue;
    const item = manifestById.get(ref.idref);
    if (!item) {
      throw new ManifestResolutionError(
        `Spine references unknown manifest id: ${ref.idref}`,
      );
    }
    const content = getEntryText(entries, item.href, `Spine document ${item.href}`);
    readingOrderDocuments.push({ path: item.href, content });
  }

  const inputChecksum = createHash("sha256").update(buffer).digest("hex");

  return {
    inputChecksum,
    entries,
    entryOrder,
    opfPath,
    opfDir,
    manifest,
    spine,
    readingOrderDocuments,
  };
}
