import type { AppDatabase } from "./database.js";
import type { Segment, SegmentStatus } from "../domain/segment.js";
import type { DraftSegment } from "../epub/paragraph-segmenter.js";

interface SegmentRow {
  job_id: string;
  id: string;
  chapter_path: string;
  element_locator: string;
  order_index: number;
  source_text: string;
  source_html: string;
  source_checksum: string;
  translated_text: string | null;
  translated_html: string | null;
  status: string;
  retry_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
}

function rowToSegment(row: SegmentRow): Segment {
  return {
    id: row.id,
    jobId: row.job_id,
    chapterPath: row.chapter_path,
    elementLocator: row.element_locator,
    orderIndex: row.order_index,
    sourceText: row.source_text,
    sourceHtml: row.source_html,
    sourceChecksum: row.source_checksum,
    translatedText: row.translated_text,
    translatedHtml: row.translated_html,
    status: row.status as SegmentStatus,
    retryCount: row.retry_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    errorMessage: row.error_message,
  };
}

export class SegmentRepository {
  constructor(private readonly db: AppDatabase) {}

  insertMany(jobId: string, segments: DraftSegment[]): void {
    const insert = this.db.prepare(
      `INSERT INTO segments (
        job_id, id, chapter_path, element_locator, order_index,
        source_text, source_html, source_checksum, status
      ) VALUES (@jobId, @id, @chapterPath, @elementLocator, @orderIndex,
        @sourceText, @sourceHtml, @sourceChecksum, 'PENDING')`,
    );
    const insertAll = this.db.transaction((rows: DraftSegment[]) => {
      for (const s of rows) {
        insert.run({
          jobId,
          id: s.id,
          chapterPath: s.chapterPath,
          elementLocator: s.elementLocator,
          orderIndex: s.orderIndex,
          sourceText: s.sourceText,
          sourceHtml: s.sourceHtml,
          sourceChecksum: s.sourceChecksum,
        });
      }
    });
    insertAll(segments);
  }

  listByJob(jobId: string): Segment[] {
    const rows = this.db
      .prepare("SELECT * FROM segments WHERE job_id = ? ORDER BY order_index ASC")
      .all(jobId) as SegmentRow[];
    return rows.map(rowToSegment);
  }

  listByJobAndStatus(jobId: string, status: SegmentStatus): Segment[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM segments WHERE job_id = ? AND status = ? ORDER BY order_index ASC",
      )
      .all(jobId, status) as SegmentRow[];
    return rows.map(rowToSegment);
  }

  countByStatus(jobId: string): Record<SegmentStatus, number> {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) as count FROM segments WHERE job_id = ? GROUP BY status")
      .all(jobId) as Array<{ status: SegmentStatus; count: number }>;
    const counts: Record<SegmentStatus, number> = { PENDING: 0, TRANSLATED: 0, FAILED: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  markTranslated(
    jobId: string,
    id: string,
    result: { translatedText: string; translatedHtml: string | null; inputTokens: number; outputTokens: number },
  ): void {
    this.db
      .prepare(
        `UPDATE segments SET
          status = 'TRANSLATED',
          translated_text = @translatedText,
          translated_html = @translatedHtml,
          input_tokens = @inputTokens,
          output_tokens = @outputTokens,
          error_message = NULL
        WHERE job_id = @jobId AND id = @id`,
      )
      .run({ jobId, id, ...result });
  }

  markFailed(jobId: string, id: string, errorMessage: string): void {
    this.db
      .prepare(
        `UPDATE segments SET
          status = 'FAILED',
          error_message = @errorMessage,
          retry_count = retry_count + 1
        WHERE job_id = @jobId AND id = @id`,
      )
      .run({ jobId, id, errorMessage });
  }

  /** Resets a FAILED segment to PENDING so it will be picked up on the next run. */
  resetToPending(jobId: string, id: string): void {
    this.db
      .prepare(
        `UPDATE segments SET status = 'PENDING', error_message = NULL WHERE job_id = @jobId AND id = @id`,
      )
      .run({ jobId, id });
  }
}
