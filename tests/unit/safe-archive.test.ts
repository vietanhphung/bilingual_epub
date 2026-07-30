import { describe, expect, it } from "vitest";
import { safeExtract } from "../../src/epub/safe-archive.js";
import { InvalidEpubError, UnsafeArchiveError } from "../../src/domain/errors.js";
import {
  buildPathTraversalEpub,
  buildSimpleFixtureEpub,
} from "../fixtures/build-epub.js";

describe("safeExtract", () => {
  it("extracts a well-formed archive and preserves entry order", async () => {
    const buffer = await buildSimpleFixtureEpub();
    const { entries, entryOrder } = await safeExtract(buffer);
    expect(entryOrder[0]).toBe("mimetype");
    expect(entries.find((e) => e.path === "mimetype")?.wasStored).toBe(true);
    expect(entries.some((e) => e.path === "OEBPS/content.opf")).toBe(true);
  });

  it("rejects path traversal entries", async () => {
    const buffer = buildPathTraversalEpub();
    await expect(safeExtract(buffer)).rejects.toThrow(UnsafeArchiveError);
  });

  it("rejects archives above the input size limit", async () => {
    const buffer = await buildSimpleFixtureEpub();
    await expect(
      safeExtract(buffer, {
        maxInputBytes: 10,
        maxDecompressedBytes: 500 * 1024 * 1024,
        maxEntries: 10_000,
      }),
    ).rejects.toThrow(UnsafeArchiveError);
  });

  it("rejects archives with too many entries", async () => {
    const buffer = await buildSimpleFixtureEpub();
    await expect(
      safeExtract(buffer, {
        maxInputBytes: 100 * 1024 * 1024,
        maxDecompressedBytes: 500 * 1024 * 1024,
        maxEntries: 2,
      }),
    ).rejects.toThrow(UnsafeArchiveError);
  });

  it("rejects a non-zip buffer", async () => {
    await expect(safeExtract(Buffer.from("not a zip"))).rejects.toThrow(
      InvalidEpubError,
    );
  });
});
