import { z } from "zod";
import { cell, extractionMeta, nullableText } from "./fields.js";

/**
 * A page built around one or more tables — nutrient tables, composition
 * tables, price lists, specifications, timetables.
 *
 * THE DESIGN DECISION: TYPE BY STRUCTURE, NOT BY SUBJECT
 *
 * The obvious move for a nutrient table is to model nutrients: a `foods` array
 * where each food has `energyKj`, `protein`, `fat`, and so on. It is also a
 * trap. Every new table layout then needs a new schema, a table with a column
 * you did not anticipate loses that column silently, and the model has to
 * decide at extraction time which printed heading corresponds to which of your
 * invented field names — a judgement it makes invisibly and cannot show.
 *
 * This schema instead captures what a table *is*: headings, columns, rows,
 * footnotes. One schema then reads a nutrient table, a price list, and a
 * specification sheet equally well, and a new column is just a new column.
 *
 * What it gives up is queryability. `rows[3][2] === "12,5"` is not a nutrient
 * value you can compare across documents. That interpretation step — mapping
 * headings to known nutrients, parsing "12,5" into 12.5, normalising per-100g
 * versus per-serving — still has to happen, but it happens afterwards, in
 * ordinary deterministic code, on text you can still read and test against.
 *
 * The principle generalises past tables: give the model the job it is
 * uniquely good at (reading the page) and keep the job ordinary code is better
 * at (interpreting consistent text) out of the prompt. Every rule you move out
 * of the model is a rule that stops being probabilistic.
 */

const column = z.object({
  header: nullableText(
    'The column heading exactly as printed. If the heading spans two lines, join them with a space. Null for a column that has no heading at all — common for the leftmost column that names each row.',
  ),
  unit: nullableText(
    'The unit this column is measured in, when the table states it separately from the values — "kJ", "g", "mg/100 g". Take it from the heading if it appears there in brackets, and leave the heading text itself intact. Null if the column has no unit, or if the unit is written inside each individual value.',
  ),
});

/**
 * One table.
 *
 * `rows` is an array of rows, each an array of cells positionally aligned to
 * `columns` — not objects keyed by heading. Dynamic keys cannot be expressed in
 * a JSON Schema the model is held to, and the alignment rule below is a much
 * stronger guarantee than hoping the model invents the same key twice.
 */
const table = z
  .object({
    title: nullableText(
      "The table's own caption or heading, as printed above or below it. Null if the table is untitled.",
    ),

    columns: z
      .array(column)
      .min(1)
      .describe(
        "The columns, left to right, exactly as many as the table has. Include the leftmost label column even when its heading is blank — it is a column like any other.",
      ),

    rows: z
      .array(z.array(cell()))
      .describe(
        "The data rows, top to bottom. Each row must contain exactly one entry per column, in the same left-to-right order — use null for a blank cell rather than shortening the row. Do not include the heading row, and do not include a row that is only a section divider; put a divider's text in notes instead.",
      ),

    footnotes: z
      .array(z.string())
      .describe(
        "Footnotes printed with this table, including their markers — for example \"1) measured per 100 g\". An empty array if there are none.",
      ),
  })
  .describe("One table on the page, with its columns and rows.")
  /**
   * The project's first BUSINESS RULE, and a clean illustration of the two
   * homes a rule can have (see `fields.ts`).
   *
   * "Every row has one cell per column" is stated twice on purpose:
   *
   *  - In the `rows` description, where it survives the conversion to JSON
   *    Schema and so is an instruction the model reads and mostly follows.
   *  - Here in `.superRefine()`, where it does NOT reach the model at all and
   *    is purely a check on the answer.
   *
   * Neither alone is enough. The description cannot enforce; the refinement
   * cannot persuade. Together they are what "validate and repair" means — and
   * when this one fails, the message below is precise enough to hand straight
   * back to the model, which is exactly what milestone 7 will do with it.
   *
   * A ragged row is the most common way a table extraction goes wrong, and the
   * most damaging: every cell after the missing one is silently attributed to
   * the wrong column, so the output looks perfectly well-formed and is wrong.
   */
  .superRefine((value, ctx) => {
    for (const [index, row] of value.rows.entries()) {
      if (row.length !== value.columns.length) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index],
          message: `row ${index + 1} has ${row.length} cells but the table declares ${value.columns.length} columns — every cell after a missing one would land in the wrong column`,
        });
      }
    }
  });

export const dataTableSchema = z
  .object({
    documentTitle: nullableText(
      "The title of the page as a whole, as printed — not a table's own caption. Null if the page has no overall title.",
    ),

    tables: z
      .array(table)
      .describe(
        "Every table on the page, in reading order. A page may hold several; a page may hold one that continues across columns, which is still one table.",
      ),

    notes: z
      .array(z.string())
      .describe(
        "Text on the page that belongs to no table: an introduction, a legend, a source or copyright line, a section divider. Transcribe each as printed. Do not repeat a table's own footnotes here. An empty array if the page is nothing but tables.",
      ),

    ...extractionMeta,
  })
  .describe(
    "The contents of a page built around tables. Transcribe what is printed, column for column and row for row. Do not reformat values, do not convert units, do not reorder rows, and do not fill in a cell the page leaves blank. If a value is unreadable, say so in warnings rather than guessing at it.",
  );

export type DataTableDocument = z.infer<typeof dataTableSchema>;
