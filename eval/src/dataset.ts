import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { proseTruthSchema, tableTruthSchema, type ProseTruth, type TableTruth } from "./truth.js";

/**
 * The labelled dataset: one truth file per sample, pointing at its image.
 *
 *   eval/dataset/<name>.truth.json        committed — your own documents
 *   eval/dataset/<name>.local.truth.json  gitignored — third-party text you
 *                                         may read but not republish
 *
 * The truth file names its image explicitly rather than pairing by basename,
 * because one page often exists in several files (a PNG and a smaller JPEG of
 * the same scan) and only one of them is the sample.
 */

const TRUTH_SUFFIX = /(\.local)?\.truth\.json$/;

const envelope = z.object({
  image: z.string().min(1),
  type: z.enum(["table", "prose"]),
  expected: z.unknown(),
});

interface SampleBase {
  name: string;
  imagePath: string;
  truthPath: string;
}

export type Sample =
  | (SampleBase & { type: "table"; expected: TableTruth })
  | (SampleBase & { type: "prose"; expected: ProseTruth });

export class DatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}

export async function loadSample(truthPath: string, dir: string): Promise<Sample> {
  const name = truthPath.split("/").pop()!.replace(TRUTH_SUFFIX, "");

  let json: unknown;
  try {
    json = JSON.parse(await readFile(truthPath, "utf8"));
  } catch (cause) {
    throw new DatasetError(`${truthPath}: not valid JSON (${String(cause)})`);
  }

  const parsed = envelope.safeParse(json);
  if (!parsed.success) throw new DatasetError(`${truthPath}:\n${formatIssues(parsed.error)}`);

  const imagePath = join(dir, parsed.data.image);
  try {
    await access(imagePath);
  } catch {
    throw new DatasetError(`${truthPath}: image "${parsed.data.image}" not found in ${dir}`);
  }

  const base = { name, imagePath, truthPath };

  // The truth is held to the same schema as the model's answer, so a mistake in
  // the ground truth fails here, loudly, instead of scoring the model as wrong.
  if (parsed.data.type === "table") {
    const expected = tableTruthSchema.safeParse(parsed.data.expected);
    if (!expected.success) throw new DatasetError(`${truthPath} (expected):\n${formatIssues(expected.error)}`);
    return { ...base, type: "table", expected: expected.data };
  }

  const expected = proseTruthSchema.safeParse(parsed.data.expected);
  if (!expected.success) throw new DatasetError(`${truthPath} (expected):\n${formatIssues(expected.error)}`);
  return { ...base, type: "prose", expected: expected.data };
}

export async function loadDataset(dir: string): Promise<Sample[]> {
  const files = (await readdir(dir)).filter((file) => TRUTH_SUFFIX.test(file)).sort();
  return Promise.all(files.map((file) => loadSample(join(dir, file), dir)));
}
