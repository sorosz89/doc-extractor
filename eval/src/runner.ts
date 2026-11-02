import { performance } from "node:perf_hooks";
import { extractDocument, type StructuringModel } from "../../src/extract/extractDocument.js";
import { loadImage as defaultLoadImage, type LoadedImage } from "../../src/ingest/loadImage.js";
import { DOCUMENT_TYPES } from "../../src/schemas/registry.js";
import type { Sample } from "./dataset.js";
import { scoreProse, type ProseScore } from "./score/prose.js";
import { scoreTable, type TableScore } from "./score/table.js";

interface SampleRunBase {
  name: string;
  /** 1-based; >1 only with --repeat. */
  attempt: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  validationError: string | null;
  /** The model's self-reported confidence — kept to check it against `pass`. */
  confidence: string | null;
  warnings: string[];
  /** The raw extraction, for inspecting a failure after the run. */
  extracted: unknown;
  pass: boolean;
}

export type SampleRun =
  | (SampleRunBase & { type: "table"; score: TableScore })
  | (SampleRunBase & { type: "prose"; score: ProseScore });

export interface RunnerDeps {
  loadImage?: (path: string) => Promise<LoadedImage>;
  now?: () => number;
}

function meta(data: unknown): { confidence: string | null; warnings: string[] } {
  const record = (data ?? {}) as { confidence?: string; warnings?: string[] };
  return { confidence: record.confidence ?? null, warnings: record.warnings ?? [] };
}

/**
 * One sample, one extraction, one score.
 *
 * The model is a parameter, as everywhere else in the project: the runner's
 * tests use a stub and cost nothing. Latency is wall-clock around the model
 * call only — image loading is local and would blur the number that matters.
 *
 * The type is looked up with `DOCUMENT_TYPES[sample.type]` inside each branch,
 * not through `getDocumentType()`, so the extraction keeps its precise type
 * and can be scored field by field (`course.md` lesson 5.3).
 */
export async function runSample(
  model: StructuringModel,
  sample: Sample,
  attempt = 1,
  deps: RunnerDeps = {},
): Promise<SampleRun> {
  const loadImage = deps.loadImage ?? defaultLoadImage;
  const now = deps.now ?? (() => performance.now());

  const image = await loadImage(sample.imagePath);

  if (sample.type === "table") {
    const started = now();
    const result = await extractDocument(model, image, DOCUMENT_TYPES.table);
    const latencyMs = now() - started;
    const score = scoreTable(sample.expected, result.data);
    return {
      ...common(sample, attempt, latencyMs, result),
      type: "table",
      score,
      pass: score.pass,
    };
  }

  const started = now();
  const result = await extractDocument(model, image, DOCUMENT_TYPES.prose);
  const latencyMs = now() - started;
  const score = scoreProse(sample.expected, result.data);
  return {
    ...common(sample, attempt, latencyMs, result),
    type: "prose",
    score,
    pass: score.pass,
  };
}

function common(
  sample: Sample,
  attempt: number,
  latencyMs: number,
  result: Awaited<ReturnType<typeof extractDocument>>,
): Omit<SampleRunBase, "pass"> {
  return {
    name: sample.name,
    attempt,
    latencyMs,
    inputTokens: result.usage?.input_tokens ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
    costUsd: result.cost?.totalUsd ?? null,
    validationError: result.validationError ?? null,
    ...meta(result.data),
    extracted: result.data ?? null,
  };
}
