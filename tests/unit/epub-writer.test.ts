import { describe, expect, it } from "vitest";
import { writeEpub } from "../../src/epub/epub-writer.js";
import { safeExtract } from "../../src/epub/safe-archive.js";
import { InvalidEpubError } from "../../src/domain/errors.js";

describe("writeEpub", () => {
  it("forces mimetype to the first entry and stores it uncompressed", async () => {
    const buffer = await writeEpub([
      { path: "OEBPS/content.opf", data: Buffer.from("<package/>") },
      { path: "mimetype", data: Buffer.from("application/epub+zip") },
      { path: "META-INF/container.xml", data: Buffer.from("<container/>") },
    ]);

    const { entries, entryOrder } = await safeExtract(buffer);
    expect(entryOrder[0]).toBe("mimetype");
    const mimetype = entries.find((e) => e.path === "mimetype")!;
    expect(mimetype.wasStored).toBe(true);
    expect(mimetype.data.toString("utf-8")).toBe("application/epub+zip");
  });

  it("rejects writing an archive without a mimetype entry", async () => {
    await expect(
      writeEpub([{ path: "OEBPS/content.opf", data: Buffer.from("<package/>") }]),
    ).rejects.toThrow(InvalidEpubError);
  });
});
