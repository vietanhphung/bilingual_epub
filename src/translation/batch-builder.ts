export interface BatchableSegment {
  id: string;
  chapterPath: string;
  estimatedTokens: number;
}

/** Rough, provider-independent heuristic: ~4 characters per token. */
export function estimateSegmentTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Groups segments into request-sized batches: never splits a paragraph,
 * stops adding once the (safety-margined) token target is reached, and
 * prefers not to mix chapters within a batch when that's practical (i.e.
 * without producing a batch of one). Order is preserved — callers should
 * pass segments in reading order.
 */
export function buildBatches(
  segments: BatchableSegment[],
  maxSourceTokensPerRequest: number,
  safetyMarginPercent: number,
): string[][] {
  const targetTokens = Math.max(
    1,
    Math.floor(maxSourceTokensPerRequest * (1 - safetyMarginPercent / 100)),
  );

  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let currentChapter: string | null = null;

  for (const segment of segments) {
    const hasContent = current.length > 0;
    const wouldExceedBudget = hasContent && currentTokens + segment.estimatedTokens > targetTokens;
    const chapterChanged = hasContent && currentChapter !== segment.chapterPath;

    if (wouldExceedBudget || chapterChanged) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(segment.id);
    currentTokens += segment.estimatedTokens;
    currentChapter = segment.chapterPath;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}
