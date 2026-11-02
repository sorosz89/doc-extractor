import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";

/**
 * Loading a page image for a multimodal request.
 *
 * The model never sees your file. It sees base64 bytes plus a MIME type, so
 * this stage's whole job is to turn a path into exactly that — and to reject
 * the inputs the API would reject, locally and for free.
 */

/** The image types Claude's vision API accepts. */
const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
} as const satisfies Record<string, string>;

type SupportedExtension = keyof typeof MIME_TYPES;

/**
 * Per-image ceiling on the API (5 MB). Measured on the *base64* payload, which
 * is ~4/3 the size of the file on disk, so the effective file limit is lower
 * than 5 MB. Milestone 5 (`sharp`) is what makes big scans fit.
 */
const MAX_BASE64_BYTES = 5 * 1024 * 1024;

export interface LoadedImage {
  /** Base64-encoded file contents, no data: prefix and no newlines. */
  base64: string;
  /** MIME type, required alongside base64 data. */
  mimeType: string;
  /** Size on disk, for cost and preprocessing decisions. */
  bytes: number;
  /** Filename, carried through so output can cite its source. */
  filename: string;
}

/** Thrown for an input we can reject without calling the API. */
export class ImageLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageLoadError";
  }
}

function isSupported(extension: string): extension is SupportedExtension {
  return extension in MIME_TYPES;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export async function loadImage(path: string): Promise<LoadedImage> {
  const extension = extname(path).toLowerCase();

  if (extension === ".pdf") {
    throw new ImageLoadError(
      `${path} is a PDF. Claude reads page images, so PDFs have to be split into pages first — that is milestone 5. For now, pass a PNG or JPEG.`,
    );
  }

  if (!isSupported(extension)) {
    throw new ImageLoadError(
      `Unsupported file type "${extension || "(none)"}" for ${path}. Supported: ${Object.keys(MIME_TYPES).join(", ")}.`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (cause) {
    const reason = (cause as NodeJS.ErrnoException).code === "ENOENT" ? "no such file" : String(cause);
    throw new ImageLoadError(`Could not read ${path}: ${reason}`);
  }

  const base64 = buffer.toString("base64");

  if (base64.length > MAX_BASE64_BYTES) {
    throw new ImageLoadError(
      `${path} is too large: ${formatBytes(buffer.byteLength)} on disk becomes ${formatBytes(base64.length)} as base64, over the ${formatBytes(MAX_BASE64_BYTES)} per-image API limit. Downscale it first (milestone 5 automates this).`,
    );
  }

  return {
    base64,
    mimeType: MIME_TYPES[extension],
    bytes: buffer.byteLength,
    filename: basename(path),
  };
}
