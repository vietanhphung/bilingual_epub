import type {
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationSegmentRequest,
} from "../domain/translation.js";

export interface RejectedTranslation {
  id: string;
  reason: string;
}

export interface TranslationValidationOutcome {
  /** Segment IDs that were requested, returned, and passed every check. */
  valid: Map<string, string>;
  /** Requested segments that failed validation and must be retried/failed. */
  rejected: RejectedTranslation[];
  /** Requested IDs the provider never returned a result for. */
  missingIds: string[];
  /** IDs present in the response that were never requested. */
  unexpectedIds: string[];
  /** IDs that appeared more than once in the response. */
  duplicateIds: string[];
}

const URL_PATTERN = /^https?:\/\/\S+$/i;
const NUMERIC_PATTERN = /^[\d\s.,%$€£-]+$/;

/**
 * Text that is expected to survive translation unchanged: pure numbers,
 * URLs, or strings with no alphabetic content at all (names are not
 * detectable heuristically and are intentionally not flagged here).
 */
function isLanguageNeutral(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (URL_PATTERN.test(trimmed)) return true;
  if (NUMERIC_PATTERN.test(trimmed)) return true;
  if (!/\p{L}/u.test(trimmed)) return true;
  return false;
}

function stripPlaceholderMarkup(text: string): string {
  return text.replace(/<\/?x-inline[^>]*>/g, "");
}

function validateOne(
  segment: TranslationSegmentRequest,
  translatedText: string,
): string | null {
  if (translatedText.trim().length === 0) {
    return "Translation is blank";
  }

  for (const placeholder of segment.protectedPlaceholders) {
    if (!translatedText.includes(placeholder)) {
      return `Missing protected placeholder: ${placeholder}`;
    }
  }

  const sourcePlain = stripPlaceholderMarkup(segment.text).trim();
  const translatedPlain = stripPlaceholderMarkup(translatedText).trim();
  if (sourcePlain === translatedPlain && !isLanguageNeutral(sourcePlain)) {
    return "Translation is identical to source text";
  }

  return null;
}

/**
 * Enforces the translation contract: every requested ID must come back
 * exactly once, IDs are matched explicitly (never by array position),
 * translations must be non-blank, placeholders must survive, and a
 * translation that is suspiciously identical to genuinely translatable
 * source text is rejected rather than silently accepted.
 */
export function validateTranslationBatch(
  request: TranslationBatchRequest,
  result: TranslationBatchResult,
): TranslationValidationOutcome {
  const requestedById = new Map(request.segments.map((s) => [s.id, s]));
  const valid = new Map<string, string>();
  const rejected: RejectedTranslation[] = [];
  const unexpectedIds: string[] = [];
  const duplicateIds: string[] = [];
  const seen = new Set<string>();

  for (const translation of result.translations) {
    if (seen.has(translation.id)) {
      duplicateIds.push(translation.id);
      continue;
    }
    seen.add(translation.id);

    const segment = requestedById.get(translation.id);
    if (!segment) {
      unexpectedIds.push(translation.id);
      continue;
    }

    const reason = validateOne(segment, translation.translatedText);
    if (reason) {
      rejected.push({ id: translation.id, reason });
    } else {
      valid.set(translation.id, translation.translatedText);
    }
  }

  const missingIds = request.segments
    .map((s) => s.id)
    .filter((id) => !seen.has(id));

  return { valid, rejected, missingIds, unexpectedIds, duplicateIds };
}
