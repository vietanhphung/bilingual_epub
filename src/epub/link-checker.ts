import * as cheerio from "cheerio";
import { posix } from "node:path";

export interface LinkIssue {
  code: "UNRESOLVED_LINK" | "UNRESOLVED_ANCHOR";
  message: string;
}

const EXTERNAL_HREF_PATTERN = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function getIds(html: string): Set<string> {
  const $ = cheerio.load(html, { xmlMode: true });
  const ids = new Set<string>();
  $("[id]").each((_, el) => {
    if (el.type !== "tag") return;
    const id = el.attribs["id"];
    if (id) ids.add(id);
  });
  $("[name]").each((_, el) => {
    if (el.type !== "tag") return;
    const name = el.attribs["name"];
    if (name) ids.add(name);
  });
  return ids;
}

/**
 * Checks every internal <a href="..."> across the book's XHTML documents
 * resolves to a real file in the archive and, when it carries a #fragment,
 * to a real id/name in the target document. External links (http(s):,
 * mailto:, protocol-relative, etc.) are skipped entirely.
 */
export function findUnresolvedLinks(
  documents: Array<{ path: string; content: string }>,
  entries: Map<string, Buffer>,
): LinkIssue[] {
  const issues: LinkIssue[] = [];
  const idCache = new Map<string, Set<string>>();

  const idsFor = (path: string): Set<string> | undefined => {
    if (idCache.has(path)) return idCache.get(path);
    const buf = entries.get(path);
    if (!buf) return undefined;
    const ids = getIds(buf.toString("utf-8"));
    idCache.set(path, ids);
    return ids;
  };

  for (const document of documents) {
    const $ = cheerio.load(document.content, { xmlMode: true });
    $("a[href]").each((_, el) => {
      if (el.type !== "tag") return;
      const href = el.attribs["href"];
      if (!href || href.length === 0) return;
      if (EXTERNAL_HREF_PATTERN.test(href)) return;

      const [rawPath, fragment] = href.split("#");
      const targetPath =
        rawPath === undefined || rawPath.length === 0
          ? document.path
          : posix.normalize(posix.join(posix.dirname(document.path), rawPath));

      if (!entries.has(targetPath)) {
        issues.push({
          code: "UNRESOLVED_LINK",
          message: `${document.path}: link to missing file "${href}"`,
        });
        return;
      }

      if (fragment) {
        const ids = idsFor(targetPath);
        if (!ids || !ids.has(fragment)) {
          issues.push({
            code: "UNRESOLVED_ANCHOR",
            message: `${document.path}: link to missing anchor "#${fragment}" in ${targetPath}`,
          });
        }
      }
    });
  }

  return issues;
}
