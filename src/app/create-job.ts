import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEpub } from "../epub/epub-reader.js";
import { extractTranslatableBlocks } from "../epub/content-extractor.js";
import { segmentBlocks } from "../epub/paragraph-segmenter.js";
import { JobRepository } from "../persistence/job-repository.js";
import { SegmentRepository } from "../persistence/segment-repository.js";
import type { AppDatabase } from "../persistence/database.js";
import type { BookConfig } from "../config/schema.js";
import type { Job } from "../domain/job.js";

export interface CreateJobOptions {
  inputPath: string;
  outputPath: string;
  config: BookConfig;
  provider: string;
  model: string;
}

/**
 * Reads and segments the book, then persists a job and its segments in the
 * CREATED -> EXTRACTING -> SEGMENTING -> READY sequence. Nothing is
 * translated here — this only makes the job resumable from a clean slate.
 */
export async function createJob(
  db: AppDatabase,
  options: CreateJobOptions,
): Promise<Job> {
  const inputBuffer = await readFile(options.inputPath);
  const parsed = await parseEpub(inputBuffer);

  const jobRepo = new JobRepository(db);
  const segmentRepo = new SegmentRepository(db);

  const blocks = parsed.readingOrderDocuments.flatMap((doc) =>
    extractTranslatableBlocks(doc),
  );
  const segments = segmentBlocks(blocks);

  const job = jobRepo.create({
    id: randomUUID(),
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    inputChecksum: parsed.inputChecksum,
    sourceLanguage: options.config.sourceLanguage,
    targetLanguage: options.config.targetLanguage,
    displayOrder: options.config.displayOrder,
    granularity: options.config.granularity,
    provider: options.provider,
    model: options.model,
    totalSegments: segments.length,
  });

  jobRepo.transition(job.id, "EXTRACTING");
  jobRepo.transition(job.id, "SEGMENTING");
  segmentRepo.insertMany(job.id, segments);
  return jobRepo.transition(job.id, "READY");
}
