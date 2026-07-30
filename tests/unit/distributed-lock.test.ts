import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/persistence/database.js";
import { DistributedLock } from "../../src/scheduler/distributed-lock.js";

describe("DistributedLock", () => {
  it("grants the lock to the first holder and denies a second concurrent holder", () => {
    const db = openDatabase(":memory:");
    const lock = new DistributedLock(db);

    expect(lock.tryAcquire("job-1", "holder-a")).toBe(true);
    expect(lock.tryAcquire("job-1", "holder-b")).toBe(false);
  });

  it("allows re-acquisition by the same holder (idempotent within a run)", () => {
    const db = openDatabase(":memory:");
    const lock = new DistributedLock(db);

    expect(lock.tryAcquire("job-1", "holder-a")).toBe(true);
    expect(lock.tryAcquire("job-1", "holder-a")).toBe(true);
  });

  it("allows a different job to be locked independently", () => {
    const db = openDatabase(":memory:");
    const lock = new DistributedLock(db);

    expect(lock.tryAcquire("job-1", "holder-a")).toBe(true);
    expect(lock.tryAcquire("job-2", "holder-b")).toBe(true);
  });

  it("releases and allows another holder to acquire afterward", () => {
    const db = openDatabase(":memory:");
    const lock = new DistributedLock(db);

    expect(lock.tryAcquire("job-1", "holder-a")).toBe(true);
    lock.release("job-1", "holder-a");
    expect(lock.tryAcquire("job-1", "holder-b")).toBe(true);
  });

  it("release is a no-op for a holder that doesn't hold the lock", () => {
    const db = openDatabase(":memory:");
    const lock = new DistributedLock(db);

    expect(lock.tryAcquire("job-1", "holder-a")).toBe(true);
    lock.release("job-1", "someone-else");
    expect(lock.tryAcquire("job-1", "holder-b")).toBe(false);
  });

  it("becomes acquirable again once the lease expires (crash recovery)", () => {
    vi.useFakeTimers();
    try {
      const db = openDatabase(":memory:");
      const lock = new DistributedLock(db);

      expect(lock.tryAcquire("job-1", "holder-a", 1000)).toBe(true);
      expect(lock.tryAcquire("job-1", "holder-b", 1000)).toBe(false);

      vi.advanceTimersByTime(1001);

      expect(lock.tryAcquire("job-1", "holder-b", 1000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
