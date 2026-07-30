import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectBook } from "../../app/inspect-book.js";
import { estimateSegmentTokens } from "../../translation/batch-builder.js";
import { UploadRepository, type Upload, type UploadSource } from "../../persistence/upload-repository.js";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";

/**
 * Persists an uploaded EPUB to disk and records its token estimate up
 * front. Token estimate doesn't depend on source/target language (mirrors
 * estimateBook), so price can be shown before the user even picks
 * languages.
 */
export async function storeUpload(
  db: AppDatabase,
  env: AppEnv,
  params: { userId: string; originalFilename: string; buffer: Buffer; source: UploadSource },
): Promise<Upload> {
  const inspection = await inspectBook(params.buffer);
  const sourceTokenEstimate = inspection.segments.reduce(
    (sum, s) => sum + estimateSegmentTokens(s.sourceText),
    0,
  );
  const estimatedOutputTokens = Math.ceil(sourceTokenEstimate * 1.2);

  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const id = randomUUID();
  const storedPath = join(env.UPLOAD_DIR, `${id}.epub`);
  await writeFile(storedPath, params.buffer);

  const uploads = new UploadRepository(db);
  return uploads.create({
    id,
    userId: params.userId,
    originalFilename: params.originalFilename,
    storedPath,
    source: params.source,
    inputChecksum: inspection.inputChecksum,
    sizeBytes: params.buffer.byteLength,
    chapterCount: inspection.chapterCount,
    paragraphCount: inspection.paragraphCount,
    sourceTokenEstimate,
    estimatedOutputTokens,
  });
}
