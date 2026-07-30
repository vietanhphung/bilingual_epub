import type { AppDatabase } from "./database.js";

/** YYYY-MM-DD for `date` as observed in `timezone` (en-CA formats this way natively). */
export function dateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function monthKeyInTimezone(date: Date, timezone: string): string {
  return dateKeyInTimezone(date, timezone).slice(0, 7);
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

export interface RecordUsageInput {
  jobId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timezone: string;
  now?: Date;
}

/**
 * Records provider usage across all jobs so daily/monthly budgets (which
 * protect the provider account, not any single book) can be enforced
 * regardless of which job or run produced the usage.
 */
export class UsageRepository {
  constructor(private readonly db: AppDatabase) {}

  record(input: RecordUsageInput): void {
    const now = input.now ?? new Date();
    const dateKey = dateKeyInTimezone(now, input.timezone);
    const monthKey = dateKey.slice(0, 7);
    this.db
      .prepare(
        `INSERT INTO usage_ledger (job_id, provider, model, input_tokens, output_tokens, date_key, month_key, created_at)
         VALUES (@jobId, @provider, @model, @inputTokens, @outputTokens, @dateKey, @monthKey, @createdAt)`,
      )
      .run({
        jobId: input.jobId,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        dateKey,
        monthKey,
        createdAt: now.toISOString(),
      });
  }

  sumForDateKey(dateKey: string): UsageTotals {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) as inputTokens, COALESCE(SUM(output_tokens), 0) as outputTokens
         FROM usage_ledger WHERE date_key = ?`,
      )
      .get(dateKey) as UsageTotals;
    return row;
  }

  sumForMonthKey(monthKey: string): UsageTotals {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) as inputTokens, COALESCE(SUM(output_tokens), 0) as outputTokens
         FROM usage_ledger WHERE month_key = ?`,
      )
      .get(monthKey) as UsageTotals;
    return row;
  }
}
