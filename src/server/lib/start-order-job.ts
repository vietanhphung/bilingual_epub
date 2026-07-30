import { createJob } from "../../app/create-job.js";
import { createTranslationStrategy } from "../../translation/strategy-factory.js";
import { OrderRepository, type TranslationOrder } from "../../persistence/order-repository.js";
import { UploadRepository } from "../../persistence/upload-repository.js";
import { buildPaidRunEnv } from "./paid-run-env.js";
import { enqueueJobRun } from "./job-runner.js";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";

/**
 * Turns a settled order (free grant or completed payment) into an actual
 * translation job and kicks off its background run. Shared by the free
 * path (runs immediately) and the paid path (runs once Stripe confirms
 * payment, via webhook or the reconcile fallback).
 */
export async function startOrderJob(
  db: AppDatabase,
  env: AppEnv,
  order: TranslationOrder,
): Promise<string> {
  const uploads = new UploadRepository(db);
  const orders = new OrderRepository(db);
  const upload = uploads.getOrThrow(order.uploadId);

  const strategy = createTranslationStrategy(env);
  const outputPath = upload.storedPath.replace(/\.epub$/i, `-${order.targetLanguage}-bilingual.epub`);

  const job = await createJob(db, {
    inputPath: upload.storedPath,
    outputPath,
    config: {
      sourceLanguage: order.sourceLanguage,
      targetLanguage: order.targetLanguage,
      displayOrder: order.displayOrder,
      granularity: "PARAGRAPH",
    },
    provider: strategy.provider,
    model: strategy.model,
    userId: order.userId,
  });

  orders.attachJob(order.id, job.id);

  const runEnv = buildPaidRunEnv(env, order.estimatedInputTokens, order.estimatedOutputTokens);
  enqueueJobRun(db, job.id, runEnv);
  return job.id;
}
