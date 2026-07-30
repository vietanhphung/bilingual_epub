import type { AppDatabase } from "./database.js";
import { AppError } from "../domain/errors.js";

export type UploadSource = "FILE" | "DRIVE_LINK";

export interface Upload {
  id: string;
  userId: string;
  originalFilename: string;
  storedPath: string;
  source: UploadSource;
  inputChecksum: string;
  sizeBytes: number;
  chapterCount: number;
  paragraphCount: number;
  sourceTokenEstimate: number;
  estimatedOutputTokens: number;
  createdAt: string;
}

interface UploadRow {
  id: string;
  user_id: string;
  original_filename: string;
  stored_path: string;
  source: string;
  input_checksum: string;
  size_bytes: number;
  chapter_count: number;
  paragraph_count: number;
  source_token_estimate: number;
  estimated_output_tokens: number;
  created_at: string;
}

function rowToUpload(row: UploadRow): Upload {
  return {
    id: row.id,
    userId: row.user_id,
    originalFilename: row.original_filename,
    storedPath: row.stored_path,
    source: row.source as UploadSource,
    inputChecksum: row.input_checksum,
    sizeBytes: row.size_bytes,
    chapterCount: row.chapter_count,
    paragraphCount: row.paragraph_count,
    sourceTokenEstimate: row.source_token_estimate,
    estimatedOutputTokens: row.estimated_output_tokens,
    createdAt: row.created_at,
  };
}

export type CreateUploadInput = Omit<Upload, "createdAt">;

export class UploadRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateUploadInput): Upload {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO uploads (
          id, user_id, original_filename, stored_path, source, input_checksum,
          size_bytes, chapter_count, paragraph_count, source_token_estimate,
          estimated_output_tokens, created_at
        ) VALUES (@id, @userId, @originalFilename, @storedPath, @source, @inputChecksum,
          @sizeBytes, @chapterCount, @paragraphCount, @sourceTokenEstimate,
          @estimatedOutputTokens, @now)`,
      )
      .run({ ...input, now });
    return this.getOrThrow(input.id);
  }

  get(id: string): Upload | undefined {
    const row = this.db.prepare("SELECT * FROM uploads WHERE id = ?").get(id) as
      | UploadRow
      | undefined;
    return row ? rowToUpload(row) : undefined;
  }

  getOrThrow(id: string): Upload {
    const upload = this.get(id);
    if (!upload) throw new AppError(`Upload not found: ${id}`, "UPLOAD_NOT_FOUND");
    return upload;
  }
}
