import type { AppDatabase } from "./database.js";
import { canTransition, type Job, type JobStatus } from "../domain/job.js";
import type { DisplayOrder, Granularity, SupportedLanguage } from "../domain/translation.js";
import { AppError } from "../domain/errors.js";

interface JobRow {
  id: string;
  user_id: string | null;
  input_path: string;
  output_path: string;
  input_checksum: string;
  source_language: string;
  target_language: string;
  display_order: string;
  granularity: string;
  provider: string;
  model: string;
  status: string;
  total_segments: number;
  completed_segments: number;
  failed_segments: number;
  accumulated_input_tokens: number;
  accumulated_output_tokens: number;
  estimated_cost: number | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  error_message: string | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.user_id,
    inputPath: row.input_path,
    outputPath: row.output_path,
    inputChecksum: row.input_checksum,
    sourceLanguage: row.source_language as SupportedLanguage,
    targetLanguage: row.target_language as SupportedLanguage,
    displayOrder: row.display_order as DisplayOrder,
    granularity: row.granularity as Granularity,
    provider: row.provider,
    model: row.model,
    status: row.status as JobStatus,
    totalSegments: row.total_segments,
    completedSegments: row.completed_segments,
    failedSegments: row.failed_segments,
    accumulatedInputTokens: row.accumulated_input_tokens,
    accumulatedOutputTokens: row.accumulated_output_tokens,
    estimatedCost: row.estimated_cost,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    errorMessage: row.error_message,
  };
}

export interface CreateJobInput {
  id: string;
  userId?: string | undefined;
  inputPath: string;
  outputPath: string;
  inputChecksum: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  displayOrder: DisplayOrder;
  granularity: Granularity;
  provider: string;
  model: string;
  totalSegments: number;
}

export class JobRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateJobInput): Job {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (
          id, user_id, input_path, output_path, input_checksum, source_language, target_language,
          display_order, granularity, provider, model, status, total_segments,
          completed_segments, failed_segments, accumulated_input_tokens,
          accumulated_output_tokens, estimated_cost, created_at, updated_at,
          last_run_at, next_run_at, error_message
        ) VALUES (@id, @userId, @inputPath, @outputPath, @inputChecksum, @sourceLanguage, @targetLanguage,
          @displayOrder, @granularity, @provider, @model, 'CREATED', @totalSegments,
          0, 0, 0, 0, NULL, @now, @now, NULL, NULL, NULL)`,
      )
      .run({ userId: null, ...input, now });
    return this.getOrThrow(input.id);
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | JobRow
      | undefined;
    return row ? rowToJob(row) : undefined;
  }

  getOrThrow(id: string): Job {
    const job = this.get(id);
    if (!job) {
      throw new AppError(`Job not found: ${id}`, "JOB_NOT_FOUND");
    }
    return job;
  }

  list(): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
      .all() as JobRow[];
    return rows.map(rowToJob);
  }

  /**
   * The only way a job's status changes. Enforces the state machine so
   * nothing — including the LLM — can push a job through an invalid
   * transition (e.g. straight from CREATED to COMPLETED).
   */
  transition(id: string, to: JobStatus, patch: Partial<{ errorMessage: string | null }> = {}): Job {
    const job = this.getOrThrow(id);
    if (!canTransition(job.status, to)) {
      throw new AppError(
        `Invalid job status transition: ${job.status} -> ${to}`,
        "INVALID_JOB_TRANSITION",
      );
    }
    this.db
      .prepare(
        `UPDATE jobs SET status = @status, updated_at = @now, error_message = @errorMessage WHERE id = @id`,
      )
      .run({
        id,
        status: to,
        now: new Date().toISOString(),
        errorMessage: patch.errorMessage ?? job.errorMessage,
      });
    return this.getOrThrow(id);
  }

  updateProgress(
    id: string,
    progress: {
      completedSegments: number;
      failedSegments: number;
      accumulatedInputTokens: number;
      accumulatedOutputTokens: number;
    },
  ): Job {
    this.db
      .prepare(
        `UPDATE jobs SET
          completed_segments = @completedSegments,
          failed_segments = @failedSegments,
          accumulated_input_tokens = @accumulatedInputTokens,
          accumulated_output_tokens = @accumulatedOutputTokens,
          updated_at = @now
        WHERE id = @id`,
      )
      .run({ id, ...progress, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }

  touchRunTimestamps(id: string, lastRunAt: string, nextRunAt: string | null): Job {
    this.db
      .prepare(
        `UPDATE jobs SET last_run_at = @lastRunAt, next_run_at = @nextRunAt, updated_at = @now WHERE id = @id`,
      )
      .run({ id, lastRunAt, nextRunAt, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }
}
