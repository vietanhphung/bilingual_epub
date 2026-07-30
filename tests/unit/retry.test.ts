import { describe, expect, it, vi } from "vitest";
import { withRetry, isRetryable } from "../../src/translation/retry.js";
import {
  AuthenticationError,
  RateLimitError,
  TranslationProviderError,
} from "../../src/domain/errors.js";

describe("isRetryable", () => {
  it("never retries authentication errors", () => {
    expect(isRetryable(new AuthenticationError("bad key"))).toBe(false);
  });

  it("retries rate limit errors", () => {
    expect(isRetryable(new RateLimitError("slow down"))).toBe(true);
  });

  it("respects the retryable flag on generic provider errors", () => {
    expect(isRetryable(new TranslationProviderError("boom", true))).toBe(true);
    expect(isRetryable(new TranslationProviderError("boom", false))).toBe(false);
  });

  it("does not retry unknown errors", () => {
    expect(isRetryable(new Error("weird"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result on first success without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, sleep });
    expect(result).toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries retryable errors up to maxRetries and then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new RateLimitError("slow down"));
      return Promise.resolve("recovered");
    });
    const result = await withRetry(fn, { maxRetries: 3, sleep });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on a non-retryable error without sleeping", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new AuthenticationError("bad key"));
    await expect(withRetry(fn, { maxRetries: 3, sleep })).rejects.toThrow(AuthenticationError);
    expect(sleep).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new RateLimitError("still slow"));
    await expect(withRetry(fn, { maxRetries: 2, sleep })).rejects.toThrow(RateLimitError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("honors a provider-supplied retry-after delay", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls < 2) return Promise.reject(new RateLimitError("slow down", 5000));
      return Promise.resolve("ok");
    });
    await withRetry(fn, { maxRetries: 3, sleep, maxDelayMs: 60_000 });
    expect(sleep).toHaveBeenCalledWith(5000);
  });
});
