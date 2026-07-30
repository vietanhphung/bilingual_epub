import { Command } from "commander";
import { getDatabase } from "../../persistence/database.js";
import { loadEnv } from "../../config/env.js";
import { createTranslationStrategy } from "../../translation/strategy-factory.js";
import { SchedulerService, buildCronExpression } from "../../scheduler/scheduler-service.js";
import { getLogger } from "../../logging/logger.js";
import type { Job } from "../../domain/job.js";
import type { AppEnv } from "../../config/schema.js";

export function registerSchedulerCommand(program: Command): void {
  const scheduler = program
    .command("scheduler")
    .description("Manage the local scheduler");

  scheduler
    .command("start")
    .description("Start the local scheduler (blocks until interrupted)")
    .action(() => {
      const logger = getLogger();
      const env = loadEnv();
      const db = getDatabase();

      if (env.SCHEDULE_MODE === "MANUAL") {
        console.log(
          "SCHEDULE_MODE is MANUAL: there is nothing to schedule. Run jobs directly with 'bilingual-epub run <job-id>'.",
        );
        return;
      }

      const service = new SchedulerService({
        db,
        env,
        strategyForJob: (job: Job) =>
          createTranslationStrategy({
            ...env,
            LLM_PROVIDER: job.provider as AppEnv["LLM_PROVIDER"],
            LLM_MODEL: job.model,
          }),
      });

      const expression = buildCronExpression(env);
      const started = service.start();
      if (!started) {
        console.log("Nothing to schedule.");
        return;
      }

      console.log(
        `Scheduler started: ${env.SCHEDULE_MODE} at cron '${expression}' (${env.SCHEDULE_TIMEZONE}). Press Ctrl+C to stop.`,
      );
      logger.info({ mode: env.SCHEDULE_MODE, expression, timezone: env.SCHEDULE_TIMEZONE }, "scheduler started");

      const shutdown = () => {
        console.log("\nStopping scheduler...");
        service.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
