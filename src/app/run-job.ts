import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseEpub } from "../epub/epub-reader.js";
import {
  renderBilingualEpub,
  type SegmentTranslationOutcome,
} from "../epub/bilingual-renderer.js";
import { writeEpub } from "../epub/epub-writer.js";
import { validateEpub } from "../epub/epub-validator.js";
import { JobRepository } from "../persistence/job-repository.js";
import { SegmentRepository } from "../persistence/segment-repository.js";
import {
  translatePendingSegments,
  type OrchestratorRunResult,
} from "../translation/translation-orchestrator.js";
import { budgetConfigFromEnv } from "../budget/token-budget-manager.js";
import { DistributedLock } from "../scheduler/distributed-lock.js";
import { buildProcessingReport, writeProcessingReport } from "./processing-report.js";
import type { AppDatabase } from "../persistence/database.js";
import type { AppEnv } from "../config/schema.js";
import type { TranslationStrategy } from "../domain/translation.js";
import type { Job } from "../domain/job.js";
import type { ValidationIssue } from "../epub/epub-validator.js";

export interface RunJobOptions {
  /** Render with source text standing in for any FAILED segments instead of failing the job. */
  allowUntranslated?: boolean;
}

export interface RunJobResult {
  job: Job;
  orchestratorRun?: OrchestratorRunResult;
  /** True when another execution already holds this job's lock; nothing was done. */
  skippedLocked?: boolean;
  /** Path to the JSON processing report, written whenever rendering was attempted. */
  reportPath?: string;
}

/**
 * Runs one bounded processing cycle for a job: translates whatever is
 * PENDING (resuming cleanly — TRANSLATED segments are never resent), and
 * once nothing is left pending, renders and writes the output EPUB. A job
 * not in a runnable state (COMPLETED/FAILED/CANCELLED/RENDERING/...) is
 * returned unchanged.
 *
 * Holds a per-job lock for the duration of the run so a second CLI
 * invocation or a scheduler tick racing a manual run can never process
 * the same job concurrently; if the lock is already held, this returns
 * immediately with skippedLocked: true instead of blocking or erroring.
 */
export async function runJob(
  db: AppDatabase,
  jobId: string,
  strategy: TranslationStrategy,
  env: AppEnv,
  options: RunJobOptions = {},
): Promise<RunJobResult> {
  const jobRepo = new JobRepository(db);
  const segmentRepo = new SegmentRepository(db);

  let job = jobRepo.getOrThrow(jobId);

  if (
    job.status === "READY" ||
    job.status === "PAUSED_BUDGET" ||
    job.status === "PAUSED_RATE_LIMIT"
  ) {
    job = jobRepo.transition(jobId, "TRANSLATING");
  }

  if (job.status !== "TRANSLATING") {
    return { job };
  }

  const lock = new DistributedLock(db);
  const holderId = `${process.pid}-${randomUUID()}`;
  if (!lock.tryAcquire(jobId, holderId)) {
    return { job, skippedLocked: true };
  }

  try {
    const runResult = await translatePendingSegments(db, job, strategy, {
      budget: budgetConfigFromEnv(env),
      timezone: env.SCHEDULE_TIMEZONE,
      requestDelayMs: env.REQUEST_DELAY_MS,
      pricing: {
        inputPricePerMillionTokensUsd: env.MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD,
        outputPricePerMillionTokensUsd: env.MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD,
      },
    });

    const counts = segmentRepo.countByStatus(jobId);
    job = jobRepo.updateProgress(jobId, {
      completedSegments: counts.TRANSLATED,
      failedSegments: counts.FAILED,
      accumulatedInputTokens: job.accumulatedInputTokens + runResult.inputTokens,
      accumulatedOutputTokens: job.accumulatedOutputTokens + runResult.outputTokens,
    });
    jobRepo.touchRunTimestamps(jobId, new Date().toISOString(), null);
    job = jobRepo.getOrThrow(jobId);

    if (runResult.stopReason === "AUTH_ERROR") {
      job = jobRepo.transition(jobId, "FAILED", {
        errorMessage: runResult.stopMessage ?? "Authentication error",
      });
      return { job, orchestratorRun: runResult };
    }

    if (counts.PENDING > 0) {
      const pauseStatus = runResult.stopReason === "RATE_LIMIT" ? "PAUSED_RATE_LIMIT" : "PAUSED_BUDGET";
      job = jobRepo.transition(jobId, pauseStatus, {
        errorMessage: runResult.stopMessage ?? null,
      });
      return { job, orchestratorRun: runResult };
    }

    if (counts.FAILED > 0 && !options.allowUntranslated) {
      job = jobRepo.transition(jobId, "FAILED", {
        errorMessage: `${counts.FAILED} segment(s) failed to translate. Re-run with --allow-untranslated to render with source text in their place.`,
      });
      return { job, orchestratorRun: runResult };
    }

    job = jobRepo.transition(jobId, "RENDERING");

    const inputBuffer = await readFile(job.inputPath);
    const parsed = await parseEpub(inputBuffer);
    if (parsed.inputChecksum !== job.inputChecksum) {
      job = jobRepo.transition(jobId, "FAILED", {
        errorMessage: "Input file changed since the job was created; refusing to render.",
      });
      return { job, orchestratorRun: runResult };
    }

    const allSegments = segmentRepo.listByJob(jobId);
    const segmentsByChapter = new Map<string, Array<{ id: string }>>();
    const outcomesBySegmentId = new Map<string, SegmentTranslationOutcome>();
    for (const segment of allSegments) {
      const list = segmentsByChapter.get(segment.chapterPath) ?? [];
      list.push({ id: segment.id });
      segmentsByChapter.set(segment.chapterPath, list);

      outcomesBySegmentId.set(
        segment.id,
        segment.status === "TRANSLATED" && segment.translatedHtml
          ? { status: "TRANSLATED", translatedHtml: segment.translatedHtml }
          : { status: "FAILED" },
      );
    }

    const entries = renderBilingualEpub(parsed, segmentsByChapter, outcomesBySegmentId, {
      sourceLanguage: job.sourceLanguage,
      targetLanguage: job.targetLanguage,
      displayOrder: job.displayOrder,
    });
    const outputBuffer = await writeEpub(entries);

    job = jobRepo.transition(jobId, "VALIDATING");
    const validation = await validateEpub(outputBuffer);
    if (!validation.valid) {
      job = jobRepo.transition(jobId, "FAILED", {
        errorMessage: `Output validation failed: ${validation.issues.map((i) => i.code).join(", ")}`,
      });
      const reportPath = await writeReport(job, segmentRepo, validation.issues);
      return { job, orchestratorRun: runResult, reportPath };
    }

    await writeFile(job.outputPath, outputBuffer);
    job = jobRepo.transition(jobId, "COMPLETED");
    const reportPath = await writeReport(job, segmentRepo, validation.issues);

    return { job, orchestratorRun: runResult, reportPath };
  } finally {
    lock.release(jobId, holderId);
  }
}

async function writeReport(
  job: Job,
  segmentRepo: SegmentRepository,
  validationIssues: ValidationIssue[],
): Promise<string> {
  const failedSegments = segmentRepo.listByJobAndStatus(job.id, "FAILED");
  const report = buildProcessingReport(job, failedSegments, validationIssues);
  return writeProcessingReport(job.outputPath, report);
}
