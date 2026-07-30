export type SupportedLanguage = "en" | "fr";
export type DisplayOrder = "ENGLISH_FIRST" | "FRENCH_FIRST";
export type Granularity = "PARAGRAPH";

export interface TranslationSegmentRequest {
  id: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  text: string;
  protectedPlaceholders: string[];
}

export interface TranslationBatchRequest {
  segments: TranslationSegmentRequest[];
}

export interface TranslationSegmentResult {
  id: string;
  translatedText: string;
}

export interface TranslationUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TranslationBatchResult {
  translations: TranslationSegmentResult[];
  usage: TranslationUsage;
}

export interface TokenEstimate {
  inputTokens: number;
  estimatedOutputTokens: number;
}

export interface TranslationStrategy {
  readonly provider: string;
  readonly model: string;

  countTokens(request: TranslationBatchRequest): Promise<TokenEstimate>;

  translateBatch(
    request: TranslationBatchRequest,
  ): Promise<TranslationBatchResult>;
}
