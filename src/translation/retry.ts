import { AuthenticationError, RateLimitError, TranslationProviderError } from "../domain/errors.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classifies whether an error is worth retrying. Authentication and
 * malformed-request errors are never retried — retrying them just burns
 * time and, for auth, may trigger provider lockouts. Rate limits and
 * generic provider errors marked retryable get exponential backoff with
 * jitter, honoring a provider-supplied retry-after when present.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AuthenticationError) return false;
  if (err instanceof RateLimitError) return true;
  if (err instanceof TranslationProviderError) return err.retryable;
  return false;
}

function computeDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, maxDelayMs);
  }
  const exponential = baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = Math.random() * capped * 0.25;
  return capped - jitter / 2 + jitter;
}

/**
 * Runs `fn`, retrying with exponential backoff + jitter on retryable
 * errors up to `maxRetries` times. Re-throws immediately on non-retryable
 * errors (auth, invalid request) or once retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || attempt >= options.maxRetries) {
        throw err;
      }
      const retryAfterMs = err instanceof RateLimitError ? err.retryAfterMs : undefined;
      const delay = computeDelayMs(attempt, baseDelayMs, maxDelayMs, retryAfterMs);
      await sleep(delay);
      attempt += 1;
    }
  }
}
