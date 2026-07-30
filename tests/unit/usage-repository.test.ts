import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/persistence/database.js";
import {
  UsageRepository,
  dateKeyInTimezone,
  monthKeyInTimezone,
} from "../../src/persistence/usage-repository.js";

describe("dateKeyInTimezone / monthKeyInTimezone", () => {
  it("formats as YYYY-MM-DD and YYYY-MM", () => {
    const date = new Date("2026-07-29T12:00:00Z");
    expect(dateKeyInTimezone(date, "UTC")).toBe("2026-07-29");
    expect(monthKeyInTimezone(date, "UTC")).toBe("2026-07");
  });

  it("respects the configured timezone across a day boundary", () => {
    // 01:30 UTC is still July 28th in America/Los_Angeles (UTC-7 in July).
    const date = new Date("2026-07-29T01:30:00Z");
    expect(dateKeyInTimezone(date, "America/Los_Angeles")).toBe("2026-07-28");
  });
});

describe("UsageRepository", () => {
  it("sums recorded usage for the matching date and month keys only", () => {
    const db = openDatabase(":memory:");
    const repo = new UsageRepository(db);
    const day1 = new Date("2026-07-29T10:00:00Z");
    const day2 = new Date("2026-07-30T10:00:00Z");

    repo.record({ jobId: "job-1", provider: "mock", model: "mock-1", inputTokens: 100, outputTokens: 50, timezone: "UTC", now: day1 });
    repo.record({ jobId: "job-1", provider: "mock", model: "mock-1", inputTokens: 200, outputTokens: 80, timezone: "UTC", now: day1 });
    repo.record({ jobId: "job-2", provider: "mock", model: "mock-1", inputTokens: 5, outputTokens: 5, timezone: "UTC", now: day2 });

    expect(repo.sumForDateKey("2026-07-29")).toEqual({ inputTokens: 300, outputTokens: 130 });
    expect(repo.sumForDateKey("2026-07-30")).toEqual({ inputTokens: 5, outputTokens: 5 });
    expect(repo.sumForMonthKey("2026-07")).toEqual({ inputTokens: 305, outputTokens: 135 });
  });

  it("returns zero totals when nothing has been recorded", () => {
    const db = openDatabase(":memory:");
    const repo = new UsageRepository(db);
    expect(repo.sumForDateKey("2026-01-01")).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(repo.sumForMonthKey("2026-01")).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
