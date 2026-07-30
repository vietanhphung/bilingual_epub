import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { estimateBook } from "../../app/estimate-book.js";
import { resolveBookConfig } from "../../config/resolve-book-config.js";
import { resolvePreset, type RunBudgetPreset } from "../../config/presets.js";
import { loadEnv } from "../../config/env.js";
import { AppError } from "../../domain/errors.js";

interface EstimateOptions {
  source?: string;
  target?: string;
  preset?: string;
}

const PRESET_FLAG_MAP: Record<string, "SAFE_DAILY" | "BALANCED_DAILY" | "WEEKLY"> = {
  "safe-daily": "SAFE_DAILY",
  "balanced-daily": "BALANCED_DAILY",
  weekly: "WEEKLY",
};

export function registerEstimateCommand(program: Command): void {
  program
    .command("estimate <epubPath>")
    .description("Dry-run cost/token estimate without translation calls")
    .option("--source <lang>", "source language (en|fr)")
    .option("--target <lang>", "target language (en|fr)")
    .option("--preset <preset>", "safe-daily|balanced-daily|weekly|custom", "balanced-daily")
    .action(async (epubPath: string, options: EstimateOptions) => {
      try {
        resolveBookConfig({ sourceLanguage: options.source, targetLanguage: options.target });

        const env = loadEnv();
        const presetKey = (options.preset ?? "balanced-daily").toLowerCase();
        const preset: RunBudgetPreset =
          presetKey === "custom"
            ? {
                maxRequestsPerRun: env.MAX_REQUESTS_PER_RUN,
                maxSourceTokensPerRequest: env.MAX_SOURCE_TOKENS_PER_REQUEST,
                maxInputTokensPerRun: env.MAX_INPUT_TOKENS_PER_RUN,
                maxOutputTokensPerRun: env.MAX_OUTPUT_TOKENS_PER_RUN,
                tokenSafetyMarginPercent: env.TOKEN_SAFETY_MARGIN_PERCENT,
                scheduleMode: env.SCHEDULE_MODE,
              }
            : resolvePreset(PRESET_FLAG_MAP[presetKey] ?? "BALANCED_DAILY");

        const buffer = await readFile(epubPath);
        const report = await estimateBook(buffer, preset, {
          inputPricePerMillionTokensUsd: env.MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD,
          outputPricePerMillionTokensUsd: env.MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD,
        });

        console.log(`Input: ${epubPath}`);
        console.log(`Preset: ${presetKey} (${preset.scheduleMode})`);
        console.log(`Chapters: ${report.chapterCount}`);
        console.log(`Paragraphs: ${report.paragraphCount}`);
        console.log(`Estimated source tokens: ${report.sourceTokenEstimate}`);
        console.log(`Estimated output tokens: ${report.estimatedOutputTokens}`);
        console.log(`Estimated API calls: ${report.estimatedApiCalls}`);
        console.log(`Estimated scheduled runs: ${report.estimatedScheduledRuns}`);
        console.log(
          `Estimated completion date: ${report.estimatedCompletionDate ?? "n/a (manual scheduling)"}`,
        );
        console.log(
          `Estimated cost: ${report.estimatedCostUsd !== undefined ? `$${report.estimatedCostUsd.toFixed(4)}` : "unknown (pricing not configured)"}`,
        );
        if (report.unsafeParagraphs.length > 0) {
          console.log(`Paragraphs exceeding the per-request token limit (${report.unsafeParagraphs.length}):`);
          for (const p of report.unsafeParagraphs.slice(0, 20)) {
            console.log(`  ${p.chapterPath} ${p.id} (~${p.estimatedTokens} tokens)`);
          }
        }
        console.log("No translation calls were made.");
      } catch (err) {
        if (err instanceof AppError) {
          console.error(`${err.code}: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
