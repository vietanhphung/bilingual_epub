import { AppError } from "../../domain/errors.js";
import type { AppEnv } from "../../config/schema.js";

const DRIVE_ID_PATTERNS = [/\/file\/d\/([\w-]+)/, /[?&]id=([\w-]+)/];

export function extractDriveFileId(shareUrl: string): string | undefined {
  for (const pattern of DRIVE_ID_PATTERNS) {
    const match = shareUrl.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

interface FetchResult {
  buffer: Buffer;
  contentType: string;
  setCookies: string[];
}

async function fetchWithCap(
  url: string,
  maxBytes: number,
  extraHeaders?: Record<string, string>,
): Promise<FetchResult> {
  const res = await fetch(url, extraHeaders ? { redirect: "follow", headers: extraHeaders } : { redirect: "follow" });
  if (!res.ok) {
    throw new AppError(`Failed to download from Google Drive (HTTP ${res.status}).`, "DRIVE_DOWNLOAD_FAILED");
  }
  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
    throw new AppError(
      `File is larger than the ${Math.floor(maxBytes / 1_000_000)}MB upload limit.`,
      "FILE_TOO_LARGE",
    );
  }
  if (!res.body) {
    throw new AppError("Empty response from Google Drive.", "DRIVE_DOWNLOAD_FAILED");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new AppError(
        `File is larger than the ${Math.floor(maxBytes / 1_000_000)}MB upload limit.`,
        "FILE_TOO_LARGE",
      );
    }
    chunks.push(Buffer.from(chunk));
  }

  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { buffer: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "", setCookies };
}

/**
 * Downloads a file from a public/"anyone with the link" Google Drive share
 * URL. No OAuth: this is the "paste a link" tier — it cannot see private
 * files. Handles Drive's virus-scan interstitial page for medium-sized
 * files by following its confirm token; very large files may still need
 * the full OAuth Picker flow (a separate, later addition).
 */
export async function downloadFromDriveLink(env: AppEnv, shareUrl: string): Promise<Buffer> {
  const fileId = extractDriveFileId(shareUrl);
  if (!fileId) {
    throw new AppError(
      "Could not find a Google Drive file ID in that link. Paste the \"Share\" link for a single file.",
      "INVALID_DRIVE_LINK",
    );
  }

  const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
  const first = await fetchWithCap(directUrl, env.UPLOAD_MAX_BYTES);

  if (!first.contentType.includes("text/html")) {
    return first.buffer;
  }

  const html = first.buffer.toString("utf-8");
  const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
  if (!confirmMatch) {
    throw new AppError(
      "This Drive link didn't return a downloadable file. Make sure sharing is set to " +
        '"Anyone with the link" and it points at a single .epub file.',
      "DRIVE_DOWNLOAD_FAILED",
    );
  }

  const cookieHeader = first.setCookies.map((c) => c.split(";")[0]).join("; ");
  const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
  const second = await fetchWithCap(
    confirmUrl,
    env.UPLOAD_MAX_BYTES,
    cookieHeader ? { Cookie: cookieHeader } : undefined,
  );
  return second.buffer;
}
