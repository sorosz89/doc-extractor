import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadImage, ImageLoadError } from "./loadImage.js";

/** The 67-byte 1x1 PNG, enough to exercise real file IO without a fixture. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "doc-extractor-"));
  await writeFile(join(dir, "scan.png"), TINY_PNG);
  await writeFile(join(dir, "scan.JPG"), TINY_PNG);
  await writeFile(join(dir, "notes.txt"), "not an image");
  await writeFile(join(dir, "scan.pdf"), "%PDF-1.4");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadImage", () => {
  it("returns base64 data and the MIME type the API needs", async () => {
    const image = await loadImage(join(dir, "scan.png"));

    expect(image.mimeType).toBe("image/png");
    expect(image.filename).toBe("scan.png");
    expect(image.bytes).toBe(TINY_PNG.byteLength);
    expect(image.base64).toBe(TINY_PNG.toString("base64"));
    // No data: prefix and no newlines — both break the API.
    expect(image.base64).not.toContain("data:");
    expect(image.base64).not.toContain("\n");
  });

  it("maps extensions case-insensitively", async () => {
    const image = await loadImage(join(dir, "scan.JPG"));

    expect(image.mimeType).toBe("image/jpeg");
  });

  it("explains that PDFs need splitting rather than failing at the API", async () => {
    await expect(loadImage(join(dir, "scan.pdf"))).rejects.toThrow(/milestone 5/);
  });

  it("rejects an unsupported type and lists what is supported", async () => {
    await expect(loadImage(join(dir, "notes.txt"))).rejects.toThrow(ImageLoadError);
    await expect(loadImage(join(dir, "notes.txt"))).rejects.toThrow(/Supported: \.png, \.jpg/);
  });

  it("names the path when the file is missing", async () => {
    const missing = join(dir, "nope.png");

    await expect(loadImage(missing)).rejects.toThrow(ImageLoadError);
    await expect(loadImage(missing)).rejects.toThrow(new RegExp(`Could not read ${missing.replaceAll("\\", "\\\\")}: no such file`));
  });

  it("rejects a file with no extension at all", async () => {
    await expect(loadImage(join(dir, "scan"))).rejects.toThrow(/Unsupported file type "\(none\)"/);
  });
});
