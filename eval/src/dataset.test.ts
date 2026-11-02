import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataset, DatasetError } from "./dataset.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eval-dataset-"));
  await writeFile(join(dir, "page.png"), "not really a png");
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

const prose = {
  title: null,
  language: "hu",
  date: null,
  authors: [],
  text: "Szöveg.",
};

async function writeTruth(file: string, body: unknown): Promise<void> {
  await writeFile(join(dir, file), JSON.stringify(body));
}

describe("loadDataset", () => {
  it("loads committed and local truth files, ignoring everything else", async () => {
    await writeTruth("a.truth.json", { image: "page.png", type: "prose", expected: prose });
    await writeTruth("b.local.truth.json", { image: "page.png", type: "prose", expected: prose });
    await writeFile(join(dir, "notes.json"), "{}");

    const samples = await loadDataset(dir);
    expect(samples.map((s) => s.name)).toEqual(["a", "b"]);
    expect(samples[0]?.imagePath).toBe(join(dir, "page.png"));
  });

  it("rejects ground truth that breaks the extraction schema", async () => {
    await writeTruth("bad.truth.json", {
      image: "page.png",
      type: "prose",
      expected: { ...prose, date: "2022.09.24." },
    });
    await expect(loadDataset(dir)).rejects.toThrow(/date: expected an ISO date/);
  });

  it("rejects a ragged row in table truth, via the schema's own business rule", async () => {
    await writeTruth("t.truth.json", {
      image: "page.png",
      type: "table",
      expected: {
        documentTitle: null,
        tables: [{ title: null, columns: [{ header: "A", unit: null }], rows: [["1", "2"]], footnotes: [] }],
        notes: [],
      },
    });
    await expect(loadDataset(dir)).rejects.toThrow(/row 1 has 2 cells/);
  });

  it("rejects fields that are the model's opinion, not the page's content", async () => {
    await writeTruth("c.truth.json", {
      image: "page.png",
      type: "prose",
      expected: { ...prose, confidence: "high" },
    });
    // Zod strips unknown keys by default; the point is that `confidence` is not
    // in the truth type, so it can never be scored.
    const [sample] = await loadDataset(dir);
    expect(sample?.expected).not.toHaveProperty("confidence");
  });

  it("names the missing image", async () => {
    await writeTruth("d.truth.json", { image: "missing.png", type: "prose", expected: prose });
    await expect(loadDataset(dir)).rejects.toThrow(DatasetError);
    await expect(loadDataset(dir)).rejects.toThrow(/missing.png/);
  });
});
