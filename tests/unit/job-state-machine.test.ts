import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/domain/job.js";

describe("job status transitions", () => {
  it("allows the documented happy path", () => {
    expect(canTransition("CREATED", "EXTRACTING")).toBe(true);
    expect(canTransition("EXTRACTING", "SEGMENTING")).toBe(true);
    expect(canTransition("SEGMENTING", "READY")).toBe(true);
    expect(canTransition("READY", "TRANSLATING")).toBe(true);
    expect(canTransition("TRANSLATING", "RENDERING")).toBe(true);
    expect(canTransition("RENDERING", "VALIDATING")).toBe(true);
    expect(canTransition("VALIDATING", "COMPLETED")).toBe(true);
  });

  it("allows pause and resume around budget/rate limits", () => {
    expect(canTransition("TRANSLATING", "PAUSED_BUDGET")).toBe(true);
    expect(canTransition("PAUSED_BUDGET", "TRANSLATING")).toBe(true);
    expect(canTransition("TRANSLATING", "PAUSED_RATE_LIMIT")).toBe(true);
    expect(canTransition("PAUSED_RATE_LIMIT", "TRANSLATING")).toBe(true);
  });

  it("rejects skipping stages", () => {
    expect(canTransition("CREATED", "TRANSLATING")).toBe(false);
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
  });

  it("treats terminal states as having no outgoing transitions", () => {
    expect(canTransition("COMPLETED", "TRANSLATING")).toBe(false);
    expect(canTransition("FAILED", "TRANSLATING")).toBe(false);
    expect(canTransition("CANCELLED", "TRANSLATING")).toBe(false);
  });
});
