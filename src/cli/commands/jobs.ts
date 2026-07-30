import { resolve } from "node:path";
import { Command } from "commander";
import { getDatabase } from "../../persistence/database.js";
import { JobRepository } from "../../persistence/job-repository.js";
import { SegmentRepository } from "../../persistence/segment-repository.js";
import { createJob } from "../../app/create-job.js";
import { runJob } from "../../app/run-job.js";
import { loadEnv } from "../../config/env.js";
import { createTranslationStrategy } from "../../translation/strategy-factory.js";
import {
  parseDisplayOrderFlag,
  resolveBookConfig,
} from "../../config/resolve-book-config.js";
import { AppError } from "../../domain/errors.js";
import { getLogger } from "../../logging/logger.js";

function reportAppError(err: unknown): boolean {
  if (err instanceof AppError) {
    console.error(`${err.code}: ${err.message}`);
    process.exitCode = 1;
    return true;
  }
  return false;
}

interface TranslateOptions {
  output?: string;
  source?: string;
  target?: string;
  displayOrder?: string;
  provider?: string;
  schedule?: string;
}

export function registerJobCommands(program: Command): void {
  program
    .command("translate <epubPath>")
    .description("Create (and optionally run) a bilingual translation job")
    .option("--output <path>", "output EPUB path")
    .option("--source <lang>", "source language (en|fr)")
    .option("--target <lang>", "target language (en|fr)")
    .option("--display-order <order>", "english-first|french-first")
    .option("--provider <provider>", "translation provider (claude|mock)")
    .option("--schedule <mode>", "manual|daily|weekly", "manual")
    .action(async (epubPath: string, options: TranslateOptions) => {
      const logger = getLogger();
      try {
        const config = resolveBookConfig({
          sourceLanguage: options.source,
          targetLanguage: options.target,
          displayOrder: parseDisplayOrderFlag(options.displayOrder),
        });

        const env = loadEnv();
        const provider = options.provider ?? env.LLM_PROVIDER;
        const strategy = createTranslationStrategy({ ...env, LLM_PROVIDER: provider as typeof env.LLM_PROVIDER });

        const inputPath = resolve(epubPath);
        const outputPath = resolve(
          options.output ?? epubPath.replace(/\.epub$/i, "-bilingual.epub"),
        );

        const db = getDatabase();
        const job = await createJob(db, {
          inputPath,
          outputPath,
          config,
          provider: strategy.provider,
          model: strategy.model,
        });
        console.log(`Created job ${job.id} (${job.totalSegments} paragraphs)`);

        if (options.schedule && options.schedule !== "manual") {
          console.log(
            `Schedule mode '${options.schedule}' is not implemented yet; run 'bilingual-epub run ${job.id}' manually, or use 'bilingual-epub scheduler start' once it lands.`,
          );
          return;
        }

        const { job: finished, reportPath } = await runJob(db, job.id, strategy, env);
        printJobSummary(finished, reportPath);
      } catch (err) {
        if (reportAppError(err)) return;
        logger.error({ err }, "translate failed");
        throw err;
      }
    });

  program
    .command("run <jobId>")
    .description("Run one bounded processing cycle for a job")
    .option("--allow-untranslated", "render with source text in place of any failed paragraphs")
    .action(async (jobId: string, options: { allowUntranslated?: boolean }) => {
      try {
        const env = loadEnv();
        const db = getDatabase();
        const jobRepo = new JobRepository(db);
        const existing = jobRepo.getOrThrow(jobId);
        const strategy = createTranslationStrategy({
          ...env,
          LLM_PROVIDER: existing.provider as typeof env.LLM_PROVIDER,
          LLM_MODEL: existing.model,
        });
        const { job, reportPath } = await runJob(db, jobId, strategy, env, {
          allowUntranslated: options.allowUntranslated ?? false,
        });
        printJobSummary(job, reportPath);
      } catch (err) {
        if (reportAppError(err)) return;
        throw err;
      }
    });

  program
    .command("retry <jobId>")
    .description("Retry failed segments for a job")
    .action((jobId: string) => {
      try {
        const db = getDatabase();
        const jobRepo = new JobRepository(db);
        const segmentRepo = new SegmentRepository(db);
        const job = jobRepo.getOrThrow(jobId);
        const failed = segmentRepo.listByJobAndStatus(jobId, "FAILED");
        for (const segment of failed) {
          segmentRepo.resetToPending(jobId, segment.id);
        }
        if (job.status === "FAILED") {
          jobRepo.transition(jobId, "TRANSLATING");
        }
        console.log(`Reset ${failed.length} failed segment(s) to PENDING for job ${jobId}. Run 'bilingual-epub run ${jobId}' to retry.`);
      } catch (err) {
        if (reportAppError(err)) return;
        throw err;
      }
    });

  program
    .command("cancel <jobId>")
    .description("Cancel a job")
    .action((jobId: string) => {
      try {
        const db = getDatabase();
        const jobRepo = new JobRepository(db);
        const job = jobRepo.transition(jobId, "CANCELLED");
        console.log(`Cancelled job ${job.id}`);
      } catch (err) {
        if (reportAppError(err)) return;
        throw err;
      }
    });

  program
    .command("status <jobId>")
    .description("Show job progress")
    .action((jobId: string) => {
      try {
        const db = getDatabase();
        const jobRepo = new JobRepository(db);
        printJobSummary(jobRepo.getOrThrow(jobId));
      } catch (err) {
        if (reportAppError(err)) return;
        throw err;
      }
    });

  program
    .command("jobs")
    .description("List jobs")
    .action(() => {
      const db = getDatabase();
      const jobRepo = new JobRepository(db);
      const jobs = jobRepo.list();
      if (jobs.length === 0) {
        console.log("No jobs.");
        return;
      }
      for (const job of jobs) {
        console.log(
          `${job.id}  ${job.status.padEnd(16)}  ${job.sourceLanguage}->${job.targetLanguage}  ${job.completedSegments}/${job.totalSegments}  ${job.inputPath}`,
        );
      }
    });
}

function printJobSummary(
  job: {
    id: string;
    status: string;
    totalSegments: number;
    completedSegments: number;
    failedSegments: number;
    accumulatedInputTokens: number;
    accumulatedOutputTokens: number;
    outputPath: string;
    errorMessage: string | null;
  },
  reportPath?: string,
): void {
  console.log(`Job ${job.id}: ${job.status}`);
  console.log(`  Segments: ${job.completedSegments}/${job.totalSegments} translated, ${job.failedSegments} failed`);
  console.log(`  Tokens: ${job.accumulatedInputTokens} in / ${job.accumulatedOutputTokens} out`);
  if (job.status === "COMPLETED") {
    console.log(`  Output: ${job.outputPath}`);
  }
  if (job.errorMessage) {
    console.log(`  Error: ${job.errorMessage}`);
  }
  if (reportPath) {
    console.log(`  Report: ${reportPath}`);
  }
}
