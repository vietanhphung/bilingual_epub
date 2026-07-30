import { AppError } from "../domain/errors.js";
import { safeExtract, type ArchiveLimits } from "./safe-archive.js";
import { parseContainer, parseOpf } from "./epub-reader.js";
import { isWellFormedXhtmlFragment } from "./xhtml-well-formed.js";
import { findUnresolvedLinks } from "./link-checker.js";

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const XHTML_MEDIA_TYPES = new Set(["application/xhtml+xml"]);

export interface ValidateEpubOptions {
  archiveLimits?: ArchiveLimits;
}

export async function validateEpub(
  buffer: Buffer,
  options: ValidateEpubOptions = {},
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  let extracted;
  try {
    extracted = await safeExtract(buffer, options.archiveLimits);
  } catch (err) {
    return {
      valid: false,
      issues: [
        {
          code: err instanceof AppError ? err.code : "UNSAFE_ARCHIVE",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  const { entries: rawEntries, entryOrder } = extracted;
  const entries = new Map(rawEntries.map((e) => [e.path, e.data]));

  if (entryOrder[0] !== "mimetype") {
    issues.push({
      code: "MIMETYPE_NOT_FIRST",
      message: "mimetype must be the first entry in the archive",
    });
  }
  const mimetypeEntry = rawEntries.find((e) => e.path === "mimetype");
  if (!mimetypeEntry) {
    issues.push({ code: "MIMETYPE_MISSING", message: "mimetype entry is missing" });
  } else {
    if (!mimetypeEntry.wasStored) {
      issues.push({
        code: "MIMETYPE_COMPRESSED",
        message: "mimetype entry must be stored without compression",
      });
    }
    if (mimetypeEntry.data.toString("utf-8").trim() !== "application/epub+zip") {
      issues.push({
        code: "MIMETYPE_INVALID_CONTENT",
        message: "mimetype entry must contain exactly 'application/epub+zip'",
      });
    }
  }

  let opfPath: string;
  try {
    opfPath = parseContainer(entries);
  } catch (err) {
    issues.push({
      code: err instanceof AppError ? err.code : "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
    return { valid: false, issues };
  }

  let manifest, spine;
  try {
    ({ manifest, spine } = parseOpf(entries, opfPath));
  } catch (err) {
    issues.push({
      code: err instanceof AppError ? err.code : "PARSE_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
    return { valid: false, issues };
  }

  const manifestIds = new Set(manifest.map((m) => m.id));
  for (const item of manifest) {
    if (!entries.has(item.href)) {
      issues.push({
        code: "MANIFEST_FILE_MISSING",
        message: `Manifest item ${item.id} references missing file: ${item.href}`,
      });
    }
  }

  for (const ref of spine) {
    if (!manifestIds.has(ref.idref)) {
      issues.push({
        code: "SPINE_REFERENCES_UNKNOWN_ITEM",
        message: `Spine itemref references unknown manifest id: ${ref.idref}`,
      });
    }
  }

  const xhtmlDocuments: Array<{ path: string; content: string }> = [];
  for (const item of manifest) {
    if (!XHTML_MEDIA_TYPES.has(item.mediaType)) continue;
    const content = entries.get(item.href);
    if (!content) continue;
    const text = content.toString("utf-8");
    xhtmlDocuments.push({ path: item.href, content: text });

    const { wellFormed, error } = isWellFormedXhtmlFragment(text);
    if (!wellFormed) {
      issues.push({
        code: "XHTML_NOT_WELL_FORMED",
        message: `${item.href}: ${error}`,
      });
    }
  }

  for (const linkIssue of findUnresolvedLinks(xhtmlDocuments, entries)) {
    issues.push(linkIssue);
  }

  return { valid: issues.length === 0, issues };
}
