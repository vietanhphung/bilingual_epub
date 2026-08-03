import { runJob } from "../../app/run-job.js";
import { createTranslationStrategy } from "../../translation/strategy-factory.js";
import { JobRepository } from "../../persistence/job-repository.js";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { getLogger } from "../../logging/logger.js";

const RUNNABLE_STATUSES = new Set(["READY", "TRANSLATING", "PAUSED_BUDGET", "PAUSED_RATE_LIMIT"]);
const MAX_CYCLES = 200;
const CYCLE_DELAY_MS = 2000;
const MAX_CONCURRENT_JOBS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drives a job through repeated runJob() cycles until it reaches a
 * terminal state (COMPLETED/FAILED/CANCELLED) or gets stuck paused (budget
 * exhausted, rate limited) for several cycles in a row — at that point it's
 * left PAUSED_* in the DB exactly as the CLI would leave it, resumable
 * later by `bilingual-epub run <jobId>` or `scheduler start`.
 */
export async function runJobToCompletion(db: AppDatabase, jobId: string, env: AppEnv): Promise<void> {
  const logger = getLogger();
  const jobRepo = new JobRepository(db);
  let previousPendingCount: number | undefined;
  let stuckCycles = 0;

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    const job = jobRepo.getOrThrow(jobId);
    if (!RUNNABLE_STATUSES.has(job.status)) return;

    const strategy = createTranslationStrategy({
      ...env,
      LLM_PROVIDER: job.provider as typeof env.LLM_PROVIDER,
      LLM_MODEL: job.model,
    });

    try {
      // A paying (or free-grant) customer's job must not hard-fail over a
      // handful of proper nouns the translation validator can't distinguish
      // from a genuine model error (see translation-validator.ts) — give
      // every FAILED segment one automatic retry, then render with source
      // text standing in for whatever still fails (same as the CLI's
      // `--allow-untranslated` flag) instead of discarding the whole book.
      await runJob(db, jobId, strategy, env, {
        allowUntranslated: true,
        retryFailedSegmentsOnce: true,
      });
    } catch (err) {
      logger.error({ err, jobId }, "background job run failed");
      return;
    }

    const after = jobRepo.getOrThrow(jobId);
    if (!RUNNABLE_STATUSES.has(after.status)) return;

    const pendingNow = after.totalSegments - after.completedSegments - after.failedSegments;
    if (pendingNow === previousPendingCount) {
      stuckCycles += 1;
      if (stuckCycles >= 3) {
        logger.warn(
          { jobId },
          "background job run stalled on a paused budget/rate-limit; leaving it for manual/scheduled resume",
        );
        return;
      }
    } else {
      stuckCycles = 0;
    }
    previousPendingCount = pendingNow;

    await sleep(CYCLE_DELAY_MS);
  }
}

let activeCount = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_JOBS) {
    activeCount++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeCount++;
}

function releaseSlot(): void {
  activeCount--;
  const next = waiters.shift();
  if (next) next();
}

/** Fire-and-forget entry point: queues a job to run in the background, capped at MAX_CONCURRENT_JOBS. */
export function enqueueJobRun(db: AppDatabase, jobId: string, env: AppEnv): void {
  const logger = getLogger();
  void (async () => {
    await acquireSlot();
    try {
      await runJobToCompletion(db, jobId, env);
    } catch (err) {
      logger.error({ err, jobId }, "unexpected error driving background job run");
    } finally {
      releaseSlot();
    }
  })();
}
