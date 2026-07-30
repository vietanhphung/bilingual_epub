import type { SchedulerPresetName } from "./schema.js";

export interface RunBudgetPreset {
  maxRequestsPerRun: number;
  maxSourceTokensPerRequest: number;
  maxInputTokensPerRun: number;
  maxOutputTokensPerRun: number;
  tokenSafetyMarginPercent: number;
  scheduleMode: "DAILY" | "WEEKLY" | "MANUAL";
}

export const SCHEDULER_PRESETS: Record<
  Exclude<SchedulerPresetName, "CUSTOM">,
  RunBudgetPreset
> = {
  SAFE_DAILY: {
    maxRequestsPerRun: 5,
    maxSourceTokensPerRequest: 8000,
    maxInputTokensPerRun: 50_000,
    maxOutputTokensPerRun: 70_000,
    tokenSafetyMarginPercent: 20,
    scheduleMode: "DAILY",
  },
  BALANCED_DAILY: {
    maxRequestsPerRun: 10,
    maxSourceTokensPerRequest: 8000,
    maxInputTokensPerRun: 100_000,
    maxOutputTokensPerRun: 140_000,
    tokenSafetyMarginPercent: 20,
    scheduleMode: "DAILY",
  },
  WEEKLY: {
    maxRequestsPerRun: 25,
    maxSourceTokensPerRequest: 8000,
    maxInputTokensPerRun: 250_000,
    maxOutputTokensPerRun: 350_000,
    tokenSafetyMarginPercent: 20,
    scheduleMode: "WEEKLY",
  },
};

export function resolvePreset(
  name: Exclude<SchedulerPresetName, "CUSTOM">,
): RunBudgetPreset {
  return SCHEDULER_PRESETS[name];
}
