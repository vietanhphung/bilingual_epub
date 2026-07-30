import yazl from "yazl";
import { InvalidEpubError } from "../domain/errors.js";

export interface WritableEntry {
  path: string;
  data: Buffer;
}

/**
 * Rebuilds an EPUB zip from an ordered list of entries, enforcing the
 * packaging rules that reflowable-EPUB readers rely on:
 *  - "mimetype" is the first entry
 *  - "mimetype" is stored, not deflated
 *  - every other entry is compressed
 */
export function writeEpub(entries: WritableEntry[]): Promise<Buffer> {
  const mimetypeIndex = entries.findIndex((e) => e.path === "mimetype");
  if (mimetypeIndex === -1) {
    return Promise.reject(
      new InvalidEpubError("Cannot write EPUB without a mimetype entry"),
    );
  }

  const ordered = [
    entries[mimetypeIndex]!,
    ...entries.filter((_, i) => i !== mimetypeIndex),
  ];

  return new Promise((resolvePromise, reject) => {
    const zipfile = new yazl.ZipFile();
    const chunks: Buffer[] = [];

    for (const entry of ordered) {
      const isMimetype = entry.path === "mimetype";
      zipfile.addBuffer(entry.data, entry.path, {
        compress: !isMimetype,
        mtime: new Date(0),
        mode: 0o100644,
      });
    }

    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolvePromise(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", (err: Error) => reject(err));

    zipfile.end();
  });
}
