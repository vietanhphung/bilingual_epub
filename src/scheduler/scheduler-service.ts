import cron from "node-cron";
import { JobRepository } from "../persistence/job-repository.js";
import { runJob } from "../app/run-job.js";
import { getLogger } from "../logging/logger.js";
import type { AppDatabase } from "../persistence/database.js";
import type { AppEnv } from "../config/schema.js";
import type { TranslationStrategy } from "../domain/translation.js";
import type { Job, JobStatus } from "../domain/job.js";

/** Jobs with work left to do: freshly created, or paused waiting for the next run. */
const RUNNABLE_STATUSES: readonly JobStatus[] = ["READY", "PAUSED_BUDGET", "PAUSED_RATE_LIMIT"];

const DAY_OF_WEEK_TO_CRON: Record<AppEnv["SCHEDULE_DAY_OF_WEEK"], number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/**
 * Builds the cron expression for the configured schedule. Returns null for
 * MANUAL mode, which has nothing to schedule — the user runs jobs
 * explicitly via `run`/`translate`.
 */
export function buildCronExpression(env: AppEnv): string | null {
  if (env.SCHEDULE_MODE === "MANUAL") return null;

  const [hourStr, minuteStr] = env.SCHEDULE_TIME.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (env.SCHEDULE_MODE === "DAILY") {
    return `${minute} ${hour} * * *`;
  }
  const dayOfWeek = DAY_OF_WEEK_TO_CRON[env.SCHEDULE_DAY_OF_WEEK];
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

export interface SchedulerServiceOptions {
  db: AppDatabase;
  env: AppEnv;
  strategyForJob: (job: Job) => TranslationStrategy;
}

/**
 * Schedule determines when work starts; each job's own token/cost budget
 * (see TokenBudgetManager) determines when it stops. This service only
 * decides *when to look for due work* — every actual run still goes
 * through runJob's per-job lock and budget enforcement.
 */
export class SchedulerService {
  private task: ReturnType<typeof cron.schedule> | undefined;

  constructor(private readonly options: SchedulerServiceOptions) {}

  /** Runs every currently-runnable job once. A paused job resumes here on the next tick. */
  async runDueJobsOnce(): Promise<void> {
    const logger = getLogger();
    const jobRepo = new JobRepository(this.options.db);
    const dueJobs = jobRepo.list().filter((job) => RUNNABLE_STATUSES.includes(job.status));

    for (const job of dueJobs) {
      const strategy = this.options.strategyForJob(job);
      logger.info({ jobId: job.id, status: job.status }, "scheduler: running due job");
      try {
        const result = await runJob(this.options.db, job.id, strategy, this.options.env);
        if (result.skippedLocked) {
          logger.info({ jobId: job.id }, "scheduler: job locked by another execution, skipped");
          continue;
        }
        logger.info({ jobId: job.id, status: result.job.status }, "scheduler: job run complete");
      } catch (err) {
        logger.error({ jobId: job.id, err }, "scheduler: job run failed");
      }
    }
  }

  /** Starts the cron schedule. Returns false (and starts nothing) in MANUAL mode. */
  start(): boolean {
    const expression = buildCronExpression(this.options.env);
    if (!expression) return false;

    this.task = cron.schedule(
      expression,
      () => {
        void this.runDueJobsOnce();
      },
      { timezone: this.options.env.SCHEDULE_TIMEZONE },
    );
    return true;
  }

  stop(): void {
    this.task?.stop();
    this.task = undefined;
  }
}
