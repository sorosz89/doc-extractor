import type { z } from "zod";
import { dataTableSchema } from "../../src/schemas/dataTable.js";
import { proseSchema } from "../../src/schemas/prose.js";

/**
 * What a ground-truth file is allowed to claim.
 *
 * Each truth schema is the extraction schema minus the fields that are the
 * model's *opinion* rather than a fact about the page:
 *
 *  - `confidence` and `warnings` — self-assessment, not content. There is no
 *    "correct" confidence to write down.
 *  - `documentKind` (prose) — the schema asks for "your own description", so
 *    two careful humans would word it differently. Unscoreable by design.
 *
 * Reusing the extraction schema rather than writing a second one means a truth
 * file is validated by the same rules as the model's answer: a typo in your
 * ground truth (a ragged row, a date as 2022.09.24) fails loudly at load time
 * instead of silently scoring the model as wrong.
 */
export const tableTruthSchema = dataTableSchema.omit({ confidence: true, warnings: true });
export const proseTruthSchema = proseSchema.omit({
  confidence: true,
  warnings: true,
  documentKind: true,
});

export type TableTruth = z.infer<typeof tableTruthSchema>;
export type ProseTruth = z.infer<typeof proseTruthSchema>;
