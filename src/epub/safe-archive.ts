import yauzl from "yauzl";
import { InvalidEpubError, UnsafeArchiveError } from "../domain/errors.js";

export interface ArchiveLimits {
  maxInputBytes: number;
  maxDecompressedBytes: number;
  maxEntries: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxInputBytes: 100 * 1024 * 1024,
  maxDecompressedBytes: 500 * 1024 * 1024,
  maxEntries: 10_000,
};

export interface ArchiveEntry {
  path: string;
  data: Buffer;
  /** True when the zip stored this entry without compression (method 0). */
  wasStored: boolean;
}

export interface SafeExtractResult {
  entries: ArchiveEntry[];
  /** Original zip entry order, mimetype (if present) always first per the EPUB spec. */
  entryOrder: string[];
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function assertSafePath(path: string): void {
  if (path.length === 0) {
    throw new UnsafeArchiveError("Zip entry has an empty path");
  }
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    throw new UnsafeArchiveError(`Zip entry has an absolute path: ${path}`);
  }
  const segments = path.split("/");
  if (segments.some((seg) => seg === "..")) {
    throw new UnsafeArchiveError(`Zip entry attempts path traversal: ${path}`);
  }
  if (path.includes("\0")) {
    throw new UnsafeArchiveError(`Zip entry path contains a null byte: ${path}`);
  }
}

function isSymlink(entry: yauzl.Entry): boolean {
  // versionMadeBy high byte 3 == Unix; external attrs high 16 bits hold the unix mode.
  const madeByUnix = (entry.versionMadeBy >> 8) === 3;
  if (!madeByUnix) return false;
  const unixMode = entry.externalFileAttributes >>> 16;
  return (unixMode & S_IFMT) === S_IFLNK;
}

/**
 * Extracts a zip archive into memory while defending against common EPUB
 * attack vectors: path traversal, absolute paths, symlinks, oversized
 * archives, and decompression bombs. Throws UnsafeArchiveError on violation.
 */
export function safeExtract(
  buffer: Buffer,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<SafeExtractResult> {
  if (buffer.byteLength > limits.maxInputBytes) {
    return Promise.reject(
      new UnsafeArchiveError(
        `Archive exceeds maximum input size of ${limits.maxInputBytes} bytes`,
      ),
    );
  }

  return new Promise((resolvePromise, reject) => {
    const entries: ArchiveEntry[] = [];
    const entryOrder: string[] = [];
    let entryCount = 0;
    let totalDecompressed = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (result: SafeExtractResult) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zipfile) => {
        if (err || !zipfile) {
          fail(new InvalidEpubError(`Not a valid zip archive: ${err?.message ?? "unknown error"}`));
          return;
        }

        zipfile.on("error", (zipErr) => {
          // yauzl itself rejects some malicious paths (e.g. "invalid relative
          // path") before our own entry handler runs; treat any error raised
          // mid-read as a safety violation rather than a plain parse failure.
          fail(new UnsafeArchiveError(`Zip read error: ${zipErr.message}`));
        });

        zipfile.readEntry();

        zipfile.on("entry", (entry: yauzl.Entry) => {
          entryCount += 1;
          if (entryCount > limits.maxEntries) {
            fail(
              new UnsafeArchiveError(
                `Archive exceeds maximum entry count of ${limits.maxEntries}`,
              ),
            );
            return;
          }

          const path = entry.fileName;
          try {
            assertSafePath(path);
          } catch (safetyErr) {
            fail(safetyErr as Error);
            return;
          }

          if (isSymlink(entry)) {
            fail(new UnsafeArchiveError(`Zip entry is a symlink: ${path}`));
            return;
          }

          totalDecompressed += entry.uncompressedSize;
          if (totalDecompressed > limits.maxDecompressedBytes) {
            fail(
              new UnsafeArchiveError(
                `Archive exceeds maximum decompressed size of ${limits.maxDecompressedBytes} bytes`,
              ),
            );
            return;
          }

          const isDirectory = path.endsWith("/");
          if (isDirectory) {
            zipfile.readEntry();
            return;
          }

          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr || !readStream) {
              fail(
                new UnsafeArchiveError(
                  `Failed to read zip entry ${path}: ${streamErr?.message ?? "unknown"}`,
                ),
              );
              return;
            }

            const chunks: Buffer[] = [];
            let bytesRead = 0;
            readStream.on("data", (chunk: Buffer) => {
              bytesRead += chunk.length;
              if (bytesRead > limits.maxDecompressedBytes) {
                fail(
                  new UnsafeArchiveError(
                    `Zip entry ${path} exceeds maximum decompressed size`,
                  ),
                );
                readStream.destroy();
                return;
              }
              chunks.push(chunk);
            });
            readStream.on("error", (streamReadErr) => {
              fail(new UnsafeArchiveError(`Error reading entry ${path}: ${streamReadErr.message}`));
            });
            readStream.on("end", () => {
              entries.push({
                path,
                data: Buffer.concat(chunks),
                wasStored: entry.compressionMethod === 0,
              });
              entryOrder.push(path);
              zipfile.readEntry();
            });
          });
        });

        zipfile.on("end", () => {
          succeed({ entries, entryOrder });
        });
      },
    );
  });
}
