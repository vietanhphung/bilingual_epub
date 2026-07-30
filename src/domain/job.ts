import type { DisplayOrder, Granularity, SupportedLanguage } from "./translation.js";

export type JobStatus =
  | "CREATED"
  | "EXTRACTING"
  | "SEGMENTING"
  | "READY"
  | "TRANSLATING"
  | "PAUSED_BUDGET"
  | "PAUSED_RATE_LIMIT"
  | "RENDERING"
  | "VALIDATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface Job {
  id: string;
  userId: string | null;
  inputPath: string;
  outputPath: string;
  inputChecksum: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  displayOrder: DisplayOrder;
  granularity: Granularity;
  provider: string;
  model: string;
  status: JobStatus;
  totalSegments: number;
  completedSegments: number;
  failedSegments: number;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  estimatedCost: number | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  errorMessage: string | null;
}

/**
 * Valid job status transitions. The orchestrator is the only component
 * allowed to move a job between states; the LLM never decides this.
 */
export const JOB_STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  CREATED: ["EXTRACTING", "FAILED", "CANCELLED"],
  EXTRACTING: ["SEGMENTING", "FAILED", "CANCELLED"],
  SEGMENTING: ["READY", "FAILED", "CANCELLED"],
  READY: ["TRANSLATING", "CANCELLED"],
  TRANSLATING: [
    "PAUSED_BUDGET",
    "PAUSED_RATE_LIMIT",
    "RENDERING",
    "FAILED",
    "CANCELLED",
  ],
  PAUSED_BUDGET: ["TRANSLATING", "CANCELLED"],
  PAUSED_RATE_LIMIT: ["TRANSLATING", "CANCELLED"],
  RENDERING: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}
