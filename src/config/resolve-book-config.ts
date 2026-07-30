import {
  AppError,
  UnsupportedGranularityError,
  UnsupportedLanguageError,
} from "../domain/errors.js";
import { bookConfigSchema, type BookConfig } from "./schema.js";

export interface RawBookConfigInput {
  sourceLanguage?: string | undefined;
  targetLanguage?: string | undefined;
  displayOrder?: string | undefined;
  granularity?: string | undefined;
}

/**
 * Validates book configuration and re-throws Zod issues as the domain
 * error types the CLI and callers are expected to handle explicitly,
 * per the "reject unsupported languages/granularities with clear errors"
 * requirement.
 */
export function resolveBookConfig(input: RawBookConfigInput): BookConfig {
  const result = bookConfigSchema.safeParse(input);
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (path === "sourceLanguage" || path === "targetLanguage") {
      throw new UnsupportedLanguageError(
        `Unsupported or invalid ${path}: ${JSON.stringify(input[path as "sourceLanguage" | "targetLanguage"])}. ` +
          'Only "en" and "fr" are supported in version 1, and source/target must differ.',
      );
    }
    if (path === "granularity") {
      throw new UnsupportedGranularityError(
        `Unsupported granularity: ${JSON.stringify(input.granularity)}. Only "PARAGRAPH" is supported in version 1.`,
      );
    }
  }

  throw new AppError(
    result.error.issues.map((i) => i.message).join("; "),
    "INVALID_BOOK_CONFIG",
  );
}

const DISPLAY_ORDER_CLI_MAP: Record<string, "ENGLISH_FIRST" | "FRENCH_FIRST"> = {
  "english-first": "ENGLISH_FIRST",
  "french-first": "FRENCH_FIRST",
};

export function parseDisplayOrderFlag(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return DISPLAY_ORDER_CLI_MAP[value.toLowerCase()] ?? value;
}
