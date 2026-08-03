import * as cheerio from "cheerio";
import { posix } from "node:path";
import type { WritableEntry } from "./epub-writer.js";

const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const EXTERNAL_HREF_PATTERN = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const XHTML_EXTENSIONS = new Set([".xhtml", ".html", ".htm"]);

function sanitizeSegment(segment: string): string {
  const dot = segment.lastIndexOf(".");
  const base = dot > 0 ? segment.slice(0, dot) : segment;
  const ext = dot > 0 ? segment.slice(dot) : "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents (e.g. é -> e)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  return (cleaned.length > 0 ? cleaned : "file") + ext;
}

/** Sanitizes each path segment independently, preserving directory structure. */
export function sanitizeArchivePath(path: string): string {
  return path.split("/").map(sanitizeSegment).join("/");
}

function rewriteHref(
  pathMap: Map<string, string>,
  oldDocPath: string,
  newDocPath: string,
  href: string,
): string {
  const hashIndex = href.indexOf("#");
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : href.slice(hashIndex);
  if (rawPath.length === 0 || EXTERNAL_HREF_PATTERN.test(rawPath)) return href;

  const resolvedOld = posix.normalize(posix.join(posix.dirname(oldDocPath), rawPath));
  const resolvedNew = pathMap.get(resolvedOld);
  if (!resolvedNew) return href; // not one of our entries (shouldn't happen in a valid EPUB)

  const newBaseDir = posix.dirname(newDocPath);
  const relative = posix.relative(newBaseDir, resolvedNew);
  return (relative.length > 0 ? relative : posix.basename(resolvedNew)) + fragment;
}

function rewriteAttrs($: cheerio.CheerioAPI, selector: string, attr: string, rewrite: (v: string) => string): void {
  $(selector).each((_, el) => {
    if (el.type !== "tag") return;
    const value = el.attribs[attr];
    if (value) el.attribs[attr] = rewrite(value);
  });
}

/**
 * Some downstream converters (notably Amazon's Send-to-Kindle/KFX pipeline)
 * reject or silently mishandle archive paths containing spaces, accents, or
 * punctuation like `[](),'` — common in filenames inherited from a
 * scanned/ripped source book (see e.g. `Rowling,J.K.-[Harry Potter-1]...`).
 * A plain EPUB reader tolerates these paths fine, which is why our own
 * validator doesn't flag them.
 *
 * Renames every archive entry whose path isn't already ASCII-safe, and
 * rewrites every reference to it: the OPF manifest, `META-INF/container.xml`,
 * any `.ncx`, and `<a href>` / `<link href>` / `<img src>` inside XHTML
 * documents. CSS file contents (e.g. `url(...)`) are not rewritten — none of
 * this pipeline's own generated CSS uses them, and rewriting arbitrary CSS
 * safely is out of scope here.
 */
export function sanitizeEpubEntryPaths(entries: WritableEntry[]): WritableEntry[] {
  const pathMap = new Map<string, string>();
  const usedTargets = new Set<string>();

  for (const { path } of entries) {
    if (SAFE_PATH_PATTERN.test(path)) {
      pathMap.set(path, path);
      usedTargets.add(path);
    }
  }
  for (const { path } of entries) {
    if (pathMap.has(path)) continue;
    let candidate = sanitizeArchivePath(path);
    let counter = 2;
    while (usedTargets.has(candidate)) {
      const dot = candidate.lastIndexOf(".");
      const base = dot > 0 ? candidate.slice(0, dot) : candidate;
      const ext = dot > 0 ? candidate.slice(dot) : "";
      candidate = `${base}-${counter}${ext}`;
      counter += 1;
    }
    usedTargets.add(candidate);
    pathMap.set(path, candidate);
  }

  if ([...pathMap].every(([from, to]) => from === to)) {
    return entries;
  }

  return entries.map(({ path: oldPath, data }) => {
    const newPath = pathMap.get(oldPath)!;
    const ext = posix.extname(oldPath).toLowerCase();

    if (oldPath === "META-INF/container.xml") {
      // rootfile full-path is relative to the archive root, not to META-INF/
      // — resolve it with a root-level placeholder doc path (dirname ".").
      const $ = cheerio.load(data.toString("utf-8"), { xmlMode: true });
      rewriteAttrs($, "rootfile", "full-path", (v) => rewriteHref(pathMap, "ROOT", "ROOT", v));
      return { path: newPath, data: Buffer.from($.xml(), "utf-8") };
    }

    if (ext === ".opf") {
      const $ = cheerio.load(data.toString("utf-8"), { xmlMode: true });
      rewriteAttrs($, "manifest > item", "href", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      rewriteAttrs($, "guide > reference", "href", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      return { path: newPath, data: Buffer.from($.xml(), "utf-8") };
    }

    if (ext === ".ncx") {
      const $ = cheerio.load(data.toString("utf-8"), { xmlMode: true });
      rewriteAttrs($, "content", "src", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      return { path: newPath, data: Buffer.from($.xml(), "utf-8") };
    }

    if (XHTML_EXTENSIONS.has(ext)) {
      const $ = cheerio.load(data.toString("utf-8"), { xmlMode: true });
      rewriteAttrs($, "a[href]", "href", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      rewriteAttrs($, "link[href]", "href", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      rewriteAttrs($, "img[src]", "src", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      rewriteAttrs($, "image", "xlink:href", (v) => rewriteHref(pathMap, oldPath, newPath, v));
      return { path: newPath, data: Buffer.from($.xml(), "utf-8") };
    }

    return { path: newPath, data };
  });
}
