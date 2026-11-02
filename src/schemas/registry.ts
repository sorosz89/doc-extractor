import type { z } from "zod";
import { dataTableSchema } from "./dataTable.js";
import { proseSchema } from "./prose.js";

/**
 * The document-type registry: the one place that knows which schemas exist.
 *
 * This is the seam the rest of the roadmap needs:
 *
 *  - Now: the `--type` flag picks an entry by hand.
 *  - Milestone 6: a cheap Haiku classifier picks the entry instead. That is a
 *    change of *who chooses*, not a change to extraction — because extraction
 *    never names a schema, it takes one as an argument.
 *
 * Adding a document type is then: write the schema, add one line here.
 *
 * ON WHAT BELONGS IN HERE
 *
 * A registry entry is not "a kind of document that exists in the world", it is
 * "a kind of document we want a particular answer out of". Two pages with
 * different layouts are the same type if the same schema serves them; two pages
 * that look alike are different types if you want different things from them.
 *
 * The corollary matters once a classifier is choosing: a type registered here
 * that your corpus never actually contains is not harmless. It is a label the
 * classifier can pick by mistake, and every false positive it produces routes a
 * real document into a schema that cannot hold it. Keep this list to the types
 * you actually have.
 *
 * `invoice.ts` is therefore present in the repository as the worked example the
 * learning log walks through, and deliberately *not* registered.
 */

export interface DocumentType<TSchema extends z.ZodType = z.ZodType> {
  /** Stable machine key: the `--type` value, and the classifier's label later. */
  readonly key: string;
  /** How the type is named to the model and in CLI output. */
  readonly label: string;
  /**
   * The name of the tool Claude is forced to fill.
   *
   * This is part of the prompt, not an internal identifier. "record" and
   * "transcribe" are chosen over "generate" or "create" on purpose: the verb
   * frames the job as writing down what is on the page rather than producing a
   * document, and the model reads it that way.
   */
  readonly toolName: string;
  /** The Zod schema. Becomes the tool's `input_schema` and validates the answer. */
  readonly schema: TSchema;
}

export const DOCUMENT_TYPES = {
  table: {
    key: "table",
    label: "page of tables",
    toolName: "record_tables",
    schema: dataTableSchema,
  },
  prose: {
    key: "prose",
    label: "prose document",
    toolName: "transcribe_document",
    schema: proseSchema,
  },
} as const satisfies Record<string, DocumentType>;

export type DocumentTypeKey = keyof typeof DOCUMENT_TYPES;

export const DOCUMENT_TYPE_KEYS = Object.keys(DOCUMENT_TYPES) as DocumentTypeKey[];

/** Thrown for a `--type` value we have no schema for. Carries the valid set. */
export class UnknownDocumentTypeError extends Error {
  constructor(key: string) {
    super(
      `Unknown document type "${key}". Known types: ${DOCUMENT_TYPE_KEYS.join(", ")}. Add one in src/schemas/registry.ts.`,
    );
    this.name = "UnknownDocumentTypeError";
  }
}

function isDocumentTypeKey(key: string): key is DocumentTypeKey {
  return Object.hasOwn(DOCUMENT_TYPES, key);
}

/**
 * Look a type up by a key that only exists at runtime — a CLI flag today, a
 * classifier's answer in milestone 6.
 *
 * The return type is the *widened* `DocumentType`, so extracting through this
 * function yields `unknown` data rather than `DataTableDocument` or
 * `ProseDocument`. That is not a limitation to work around, it is the truth:
 * when the document type is decided at runtime, its static type cannot be known
 * at compile time. The CLI only serialises the result, so it loses nothing.
 *
 * Code that knows which type it wants should reach for the entry directly —
 * `DOCUMENT_TYPES.table` keeps its precise schema type, which is what the eval
 * harness in milestone 3 will need to compare fields against ground truth.
 */
export function getDocumentType(key: string): DocumentType {
  if (!isDocumentTypeKey(key)) throw new UnknownDocumentTypeError(key);
  return DOCUMENT_TYPES[key];
}
