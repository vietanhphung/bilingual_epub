import type {
  TokenEstimate,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationStrategy,
} from "../../domain/translation.js";

/** Rough, provider-independent heuristic: ~4 characters per token. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Deterministic offline strategy used for tests and dry runs. Never makes
 * network calls. Prefixes each segment with its target language so output
 * is trivially distinguishable from source while preserving placeholders,
 * punctuation, and whitespace verbatim.
 */
export class MockTranslationStrategy implements TranslationStrategy {
  readonly provider = "mock";
  readonly model = "mock-1";

  countTokens(request: TranslationBatchRequest): Promise<TokenEstimate> {
    const inputTokens = request.segments.reduce(
      (sum, seg) => sum + estimateTokens(seg.text),
      0,
    );
    return Promise.resolve({
      inputTokens,
      estimatedOutputTokens: Math.ceil(inputTokens * 1.2),
    });
  }

  translateBatch(
    request: TranslationBatchRequest,
  ): Promise<TranslationBatchResult> {
    let inputTokens = 0;
    let outputTokens = 0;

    const translations = request.segments.map((segment) => {
      inputTokens += estimateTokens(segment.text);
      const translatedText = `[${segment.targetLanguage.toUpperCase()}] ${segment.text}`;
      outputTokens += estimateTokens(translatedText);
      return { id: segment.id, translatedText };
    });

    return Promise.resolve({
      translations,
      usage: { inputTokens, outputTokens },
    });
  }
}
