export type SegmentStatus = "PENDING" | "TRANSLATED" | "FAILED";

export interface Segment {
  id: string;
  jobId: string;
  chapterPath: string;
  elementLocator: string;
  orderIndex: number;
  sourceText: string;
  sourceHtml: string;
  sourceChecksum: string;
  translatedText: string | null;
  translatedHtml: string | null;
  status: SegmentStatus;
  retryCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  errorMessage: string | null;
}
