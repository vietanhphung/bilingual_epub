import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  ClaudeTranslationStrategy,
  type AnthropicClientLike,
} from "../../src/translation/providers/claude-translation-strategy.js";
import {
  AuthenticationError,
  TranslationValidationError,
} from "../../src/domain/errors.js";

function fakeClient(overrides: Partial<AnthropicClientLike> = {}): AnthropicClientLike {
  return {
    messages: {
      create: vi.fn(),
    },
    beta: {
      messages: {
        countTokens: vi.fn(),
      },
    },
    ...overrides,
  } as unknown as AnthropicClientLike;
}

const request = {
  segments: [
    {
      id: "seg-1",
      sourceLanguage: "fr" as const,
      targetLanguage: "en" as const,
      text: "Bonjour.",
      protectedPlaceholders: [],
    },
  ],
};

describe("ClaudeTranslationStrategy", () => {
  it("parses a valid submit_translations tool call into a TranslationBatchResult", async () => {
    const client = fakeClient();
    (client.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "submit_translations",
          input: { translations: [{ id: "seg-1", translatedText: "Hello." }] },
        },
      ],
      usage: { input_tokens: 12, output_tokens: 6 },
    });

    const strategy = new ClaudeTranslationStrategy({
      apiKey: "test-key",
      model: "claude-test",
      client,
    });
    const result = await strategy.translateBatch(request);

    expect(result.translations).toEqual([{ id: "seg-1", translatedText: "Hello." }]);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 6 });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    const callArgs = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "submit_translations" });
    // temperature is intentionally omitted: newer models (e.g. claude-sonnet-5)
    // reject an explicit override with "temperature is deprecated for this model".
    expect(callArgs.temperature).toBeUndefined();
  });

  it("throws TranslationValidationError when no tool_use block is returned", async () => {
    const client = fakeClient();
    (client.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "I refuse." }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const strategy = new ClaudeTranslationStrategy({ apiKey: "k", model: "m", client });
    await expect(strategy.translateBatch(request)).rejects.toThrow(TranslationValidationError);
  });

  it("throws TranslationValidationError when the tool input fails schema validation", async () => {
    const client = fakeClient();
    (client.messages.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "submit_translations",
          input: { translations: [{ id: "seg-1" }] },
        },
      ],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const strategy = new ClaudeTranslationStrategy({ apiKey: "k", model: "m", client });
    await expect(strategy.translateBatch(request)).rejects.toThrow(TranslationValidationError);
  });

  it("maps a 401 response to AuthenticationError and does not retry", async () => {
    const client = fakeClient();
    const authError = Anthropic.APIError.generate(401, { message: "bad key" }, "bad key", undefined);
    (client.messages.create as ReturnType<typeof vi.fn>).mockRejectedValue(authError);

    const strategy = new ClaudeTranslationStrategy({ apiKey: "k", model: "m", client, maxRetries: 3 });
    await expect(strategy.translateBatch(request)).rejects.toThrow(AuthenticationError);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it("retries on a 429 rate limit response and eventually succeeds", async () => {
    const client = fakeClient();
    const rateLimitError = Anthropic.APIError.generate(429, { message: "slow down" }, "slow down", undefined);
    let calls = 0;
    (client.messages.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls += 1;
      if (calls < 2) return Promise.reject(rateLimitError);
      return Promise.resolve({
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "submit_translations",
            input: { translations: [{ id: "seg-1", translatedText: "Hello." }] },
          },
        ],
        usage: { input_tokens: 12, output_tokens: 6 },
      });
    });

    const strategy = new ClaudeTranslationStrategy({ apiKey: "k", model: "m", client, maxRetries: 3 });
    const result = await strategy.translateBatch(request);
    expect(result.translations[0]!.translatedText).toBe("Hello.");
    expect(calls).toBe(2);
  }, 10000);

  it("falls back to a local token estimate when the provider count endpoint fails", async () => {
    const client = fakeClient();
    (client.beta.messages.countTokens as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("beta not enabled"),
    );

    const strategy = new ClaudeTranslationStrategy({ apiKey: "k", model: "m", client });
    const estimate = await strategy.countTokens(request);
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
  });

  it("uses the provider token-counting endpoint when available", async () => {
    const client = fakeClient();
    (client.beta.messages.countTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
      input_tokens: 42,
    });

    const strategy = new ClaudeTranslationStrategy({ apiKey: "k", model: "m", client });
    const estimate = await strategy.countTokens(request);
    expect(estimate.inputTokens).toBe(42);
  });
});
