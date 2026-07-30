import { writeFile } from "node:fs/promises";
import type { Job } from "../domain/job.js";
import type { Segment } from "../domain/segment.js";
import type { ValidationIssue } from "../epub/epub-validator.js";

export interface FailureSummaryEntry {
  id: string;
  chapterPath: string;
  errorMessage: string | null;
}

export interface ProcessingReport {
  jobId: string;
  sourceFile: string;
  outputFile: string;
  sourceLanguage: string;
  targetLanguage: string;
  displayOrder: string;
  totalSegments: number;
  translatedSegments: number;
  failedSegments: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  failures: FailureSummaryEntry[];
  validationIssues: ValidationIssue[];
}

export function buildProcessingReport(
  job: Job,
  failedSegments: Segment[],
  validationIssues: ValidationIssue[],
  completedAt: string = new Date().toISOString(),
): ProcessingReport {
  return {
    jobId: job.id,
    sourceFile: job.inputPath,
    outputFile: job.outputPath,
    sourceLanguage: job.sourceLanguage,
    targetLanguage: job.targetLanguage,
    displayOrder: job.displayOrder,
    totalSegments: job.totalSegments,
    translatedSegments: job.completedSegments,
    failedSegments: job.failedSegments,
    inputTokens: job.accumulatedInputTokens,
    outputTokens: job.accumulatedOutputTokens,
    provider: job.provider,
    model: job.model,
    startedAt: job.createdAt,
    completedAt,
    failures: failedSegments.map((s) => ({
      id: s.id,
      chapterPath: s.chapterPath,
      errorMessage: s.errorMessage,
    })),
    validationIssues,
  };
}

/** Report lives next to the output EPUB, e.g. book-bilingual.epub.report.json. */
export function reportPathFor(outputPath: string): string {
  return `${outputPath}.report.json`;
}

export async function writeProcessingReport(
  outputPath: string,
  report: ProcessingReport,
): Promise<string> {
  const path = reportPathFor(outputPath);
  await writeFile(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}
