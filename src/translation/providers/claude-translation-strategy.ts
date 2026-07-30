import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AuthenticationError,
  RateLimitError,
  TranslationProviderError,
  TranslationValidationError,
} from "../../domain/errors.js";
import type {
  TokenEstimate,
  TranslationBatchRequest,
  TranslationBatchResult,
  TranslationStrategy,
} from "../../domain/translation.js";
import {
  buildSystemPrompt,
  buildUserMessage,
  SUBMIT_TRANSLATIONS_TOOL_NAME,
  SUBMIT_TRANSLATIONS_TOOL_SCHEMA,
} from "../prompt.js";
import { withRetry } from "../retry.js";

const responseSchema = z.object({
  translations: z.array(
    z.object({ id: z.string(), translatedText: z.string() }),
  ),
});

/** The subset of the Anthropic SDK client this strategy depends on — narrow enough to fake in tests. */
export type AnthropicClientLike = Pick<Anthropic, "messages"> & {
  beta: Pick<Anthropic["beta"], "messages">;
};

export interface ClaudeTranslationStrategyOptions {
  apiKey: string;
  model: string;
  maxRetries?: number;
  maxOutputTokens?: number;
  /** Injectable for tests; defaults to a real Anthropic SDK client. */
  client?: AnthropicClientLike;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * Maps Anthropic SDK errors to this app's provider-independent error
 * types so nothing outside this file needs to know about the Anthropic
 * SDK's own error hierarchy.
 */
function mapAnthropicError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AuthenticationError(err.message);
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfterHeader = err.headers?.["retry-after"];
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : undefined;
    return new RateLimitError(err.message, retryAfterMs);
  }
  if (err instanceof Anthropic.APIError) {
    // 4xx (other than rate limit/auth, handled above) are not retryable —
    // retrying a malformed or rejected request just repeats the failure.
    const retryable = err.status === undefined || err.status >= 500;
    return new TranslationProviderError(err.message, retryable);
  }
  if (err instanceof Error) {
    return new TranslationProviderError(err.message, true);
  }
  return new TranslationProviderError(String(err), true);
}

/**
 * Anthropic Claude adapter. Provider-specific SDK types never leak past
 * this file — callers only see TranslationStrategy's domain types.
 */
export class ClaudeTranslationStrategy implements TranslationStrategy {
  readonly provider = "claude";
  readonly model: string;
  private readonly client: AnthropicClientLike;
  private readonly maxRetries: number;
  private readonly maxOutputTokens: number;

  constructor(options: ClaudeTranslationStrategyOptions) {
    this.model = options.model;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.maxRetries = options.maxRetries ?? 3;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  private buildPromptParts(request: TranslationBatchRequest): {
    system: string;
    userMessage: string;
  } {
    const first = request.segments[0];
    return {
      system: buildSystemPrompt(),
      userMessage: buildUserMessage(
        request.segments.map((s) => ({ id: s.id, text: s.text })),
        first?.sourceLanguage ?? "en",
        first?.targetLanguage ?? "fr",
      ),
    };
  }

  private estimateOutputTokens(request: TranslationBatchRequest): number {
    const chars = request.segments.reduce((sum, s) => sum + s.text.length, 0);
    return Math.ceil(chars / 3.5);
  }

  private localEstimate(request: TranslationBatchRequest): TokenEstimate {
    const chars = request.segments.reduce((sum, s) => sum + s.text.length, 0);
    return {
      inputTokens: Math.ceil(chars / 4),
      estimatedOutputTokens: this.estimateOutputTokens(request),
    };
  }

  async countTokens(request: TranslationBatchRequest): Promise<TokenEstimate> {
    if (request.segments.length === 0) {
      return { inputTokens: 0, estimatedOutputTokens: 0 };
    }
    const { system, userMessage } = this.buildPromptParts(request);
    try {
      const result = await this.client.beta.messages.countTokens({
        model: this.model,
        system,
        messages: [{ role: "user", content: userMessage }],
        tools: [SUBMIT_TRANSLATIONS_TOOL_SCHEMA],
      });
      return {
        inputTokens: result.input_tokens,
        estimatedOutputTokens: this.estimateOutputTokens(request),
      };
    } catch {
      // Provider token-counting is a beta endpoint; fall back to a clearly
      // local (non-provider) estimate if it's unavailable.
      return this.localEstimate(request);
    }
  }

  async translateBatch(
    request: TranslationBatchRequest,
  ): Promise<TranslationBatchResult> {
    if (request.segments.length === 0) {
      return { translations: [], usage: { inputTokens: 0, outputTokens: 0 } };
    }

    const { system, userMessage } = this.buildPromptParts(request);

    const response = await withRetry(
      async () => {
        try {
          return await this.client.messages.create({
            model: this.model,
            max_tokens: this.maxOutputTokens,
            temperature: 0,
            system,
            messages: [{ role: "user", content: userMessage }],
            tools: [SUBMIT_TRANSLATIONS_TOOL_SCHEMA],
            tool_choice: { type: "tool", name: SUBMIT_TRANSLATIONS_TOOL_NAME },
          });
        } catch (err) {
          throw mapAnthropicError(err);
        }
      },
      { maxRetries: this.maxRetries },
    );

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new TranslationValidationError(
        "Claude response did not include a submit_translations tool call",
      );
    }

    const parsed = responseSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new TranslationValidationError(
        `Claude response failed schema validation: ${parsed.error.message}`,
      );
    }

    return {
      translations: parsed.data.translations,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
