import { z } from "zod";

/**
 * Shared building blocks for document schemas.
 *
 * Before using these, understand what a schema *is* in this pipeline. It is not
 * only a validator. `withStructuredOutput()` converts the Zod schema into JSON
 * Schema and hands it to Claude as a tool definition, so the schema is also a
 * prompt — probably the most important one in the project.
 *
 * That makes the conversion boundary the thing to keep in mind. Run it and look
 * at what comes out (there is a test in `invoice.test.ts` that does exactly
 * this):
 *
 *   .describe("...")        -> `description`   VISIBLE to the model
 *   .nullable()             -> `["T", "null"]` VISIBLE, and the key stays required
 *   .optional()             -> dropped from `required`     VISIBLE
 *   .regex(...) .min(...)   -> `pattern` `minLength`       VISIBLE
 *   .refine(...)            -> nothing at all              INVISIBLE
 *   .trim()                 -> nothing at all              INVISIBLE
 *
 * So there are two distinct places a rule can live, and the difference is not
 * stylistic:
 *
 *  - A rule the model should *follow* has to survive the conversion. "This is
 *    an ISO date" only shapes the output if it reaches the model as a
 *    `description` or a `pattern`.
 *  - A rule that is only checked *after the fact* (`.refine()`, and business
 *    rules such as "the line items sum to the subtotal") is invisible to the
 *    model by definition. It can only reject an answer, never improve one.
 *    Those belong in the validation layer of milestone 7, where a failure can
 *    be fed back to the model as a repair instruction.
 *
 * A constraint in the wrong place is a silent bug: `.refine()` on a field looks
 * like it is guiding extraction, and does nothing of the kind.
 */

/**
 * A text field that may genuinely be absent from the document.
 *
 * Two deliberate choices:
 *
 * `.nullable()` and NOT `.optional()`. They look interchangeable and are not.
 * `.optional()` lets the model leave the key out, which is indistinguishable
 * from the model forgetting it. `.nullable()` keeps the key in `required` and
 * allows `null`, so a missing field becomes an explicit, countable statement:
 * "I looked, it is not there." Milestone 3 can measure that (null-correctness);
 * it cannot measure an absent key. This is the schema-level half of
 * "return null instead of guessing" — the prompt (milestone 4) is the other half.
 *
 * `.min(1)` after `.trim()`. An empty string is the worst possible answer: it
 * is neither a value nor an admission that the value is missing, and it would
 * silently score as wrong in the eval. `minLength: 1` reaches the model as a
 * constraint *and* fails validation if it is ignored, which routes the document
 * to the repair loop instead of into the output as junk.
 */
export function nullableText(description: string) {
  return z.string().trim().min(1).nullable().describe(description);
}

/**
 * A calendar date, as a plain ISO-8601 string.
 *
 * Why a string and not `z.date()`: JSON has no date type, so the model returns
 * text either way. Keeping it text means the raw answer is preserved exactly as
 * extracted, which is what ground-truth comparison in milestone 3 needs.
 *
 * The regex is a *format* check, not a validity check. `2026-02-31` matches
 * this pattern happily. Real calendar validation is a business rule, so it
 * belongs in milestone 7 — not here, where it would be invisible to the model
 * anyway (see the note above about `.refine()`).
 */
export function isoDate(description: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date, YYYY-MM-DD")
    .nullable()
    .describe(`${description} Format: YYYY-MM-DD. Convert from whatever format the document uses.`);
}

/**
 * A monetary amount as a plain number.
 *
 * No sign constraint: credit notes and refunds carry negative amounts, and a
 * `minimum: 0` would turn a correctly-read credit note into a validation
 * failure. No `multipleOf: 0.01` either — currencies disagree about decimal
 * places, and binary floats disagree with `multipleOf` about everything.
 *
 * The description carries the real work, because the hard part is not the
 * number, it is the formatting of the number on the page: `1.234,56` is one
 * thousand two hundred in Hungary and one point two in the US.
 */
export function money(description: string) {
  return z
    .number()
    .nullable()
    .describe(
      `${description} A plain number: no currency symbol, no thousands separator, a dot for the decimal point. Mind the document's own convention — "1.234,56" means 1234.56.`,
    );
}

/** A counted or measured amount. Same reasoning as `money`, minus the currency. */
export function quantity(description: string) {
  return z
    .number()
    .nullable()
    .describe(`${description} A plain number, dot as the decimal point.`);
}

/** An ISO 4217 currency code. Length 3 reaches the model as minLength/maxLength. */
export function currencyCode(description: string) {
  return z
    .string()
    .trim()
    .length(3)
    .nullable()
    .describe(`${description} An ISO 4217 three-letter code, uppercase: EUR, USD, HUF. Infer it from a symbol if that is all the document shows.`);
}

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

/**
 * The metadata every document type carries alongside its fields.
 *
 * Spread this into each document schema (see `invoice.ts`) so that every type
 * reports its own reliability the same way and the review queue in milestone 7
 * has one thing to look at.
 *
 * On `confidence` being three words rather than a number: a model asked for a
 * 0.0-1.0 score returns 0.95 for almost everything. Self-reported probabilities
 * from an LLM are not calibrated — the number looks quantitative and measures
 * nothing. Three coarse buckets are a judgement the model can actually make,
 * and they are enough to route a document to a human. Real confidence comes
 * from measured field accuracy (milestone 3) and from validation (milestone 7),
 * never from the model's opinion of itself.
 *
 * `warnings` is the more useful of the two in practice: free text, written while
 * the model is still looking at the page, about what made the read hard. It is
 * the one place in the schema where prose is the right answer.
 */
export const extractionMeta = {
  confidence: z
    .enum(CONFIDENCE_LEVELS)
    .describe(
      "Your confidence in this extraction as a whole. high: the document is clearly legible and clearly of this type. medium: readable, but something was ambiguous. low: poor scan quality, or this does not look like the expected document type.",
    ),
  warnings: z
    .array(z.string())
    .describe(
      "Anything a human reviewer should know: fields you could not read, values you had to interpret, parts of the page that were cut off, stamps or handwriting over printed text. An empty array if the read was clean. Do not list fields that are simply absent from the document — null already says that.",
    ),
};

/** An ISO 639-1 language code. Two letters, same reasoning as `currencyCode`. */
export function languageCode(description: string) {
  return z
    .string()
    .trim()
    .length(2)
    .nullable()
    .describe(`${description} An ISO 639-1 two-letter code, lowercase: hu, en, de.`);
}

/**
 * One cell of a table, kept as text.
 *
 * Deliberately NOT a number, and this is the most consequential choice in the
 * table schema. A printed cell can be "12,5", "< 0,1", "n.a.", "—", "1 200",
 * or "nyomokban". Parsing those to numbers during extraction means the model
 * decides what each one means, on the spot, with no way to show its working —
 * and "—" silently becomes 0 or null with no record that the page said
 * something else.
 *
 * Transcribing preserves the page. Interpretation is a separate, deterministic,
 * testable step that runs afterwards on text you can still inspect. Null is for
 * a cell that is genuinely blank, which is different from a cell containing a
 * dash.
 */
export function cell() {
  return z
    .string()
    .trim()
    .min(1)
    .nullable()
    .describe(
      'One cell, transcribed exactly as printed — keep the original decimal comma, symbols such as "<" or "~", and words such as "n.a.". Do not convert to a number, do not round, do not fill in a blank. Null only for a cell that is empty on the page.',
    );
}
