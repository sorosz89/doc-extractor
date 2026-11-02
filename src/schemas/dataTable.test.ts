import { describe, it, expect } from "vitest";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { dataTableSchema, type DataTableDocument } from "./dataTable.js";

const nutrientPage: DataTableDocument = {
  documentTitle: "Tápanyagtáblázat",
  tables: [
    {
      title: "Gabonafélék",
      columns: [
        { header: null, unit: null },
        { header: "Energia", unit: "kJ" },
        { header: "Fehérje", unit: "g" },
      ],
      rows: [
        ["Búzaliszt", "1430", "10,3"],
        ["Rozsliszt", "1350", "8,2"],
        ["Zabpehely", "1580", null],
      ],
      footnotes: ["1) 100 g termékre vonatkoztatva"],
    },
  ],
  notes: ["Forrás: Új Tápanyagtáblázat, 2023."],
  confidence: "high",
  warnings: [],
};

describe("the data table schema as the model sees it", () => {
  const jsonSchema = toJsonSchema(dataTableSchema) as {
    description?: string;
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };

  it("tells the model to transcribe rather than interpret", () => {
    expect(jsonSchema.description).toMatch(/do not convert units/i);
  });

  it("requires every top-level field", () => {
    const optional = Object.keys(jsonSchema.properties ?? {}).filter(
      (name) => !(jsonSchema.required ?? []).includes(name),
    );

    expect(optional).toEqual([]);
  });

  it("states the row/column alignment rule where the model can read it", () => {
    // The same rule is enforced by superRefine below, but a `.superRefine()`
    // is invisible in the JSON Schema — so it has to be said here too, or the
    // model is being judged on a rule it was never told.
    expect(jsonSchema.properties?.tables?.description).toBeDefined();
    const tablesSchema = JSON.stringify(toJsonSchema(dataTableSchema));
    expect(tablesSchema).toMatch(/exactly one entry per column/);
  });
});

describe("dataTableSchema validation", () => {
  it("accepts a well-formed page of tables", () => {
    expect(dataTableSchema.safeParse(nutrientPage).success).toBe(true);
  });

  it("keeps cells as printed, decimal commas and all", () => {
    const parsed = dataTableSchema.parse(nutrientPage);

    // Not 10.3. The page says "10,3" and that is what gets stored; converting
    // it is a separate, testable step that runs on this text later.
    expect(parsed.tables[0]?.rows[0]?.[2]).toBe("10,3");
  });

  it("distinguishes a blank cell from a cell containing a dash", () => {
    const withDash = structuredClone(nutrientPage);
    withDash.tables[0]!.rows[2]![2] = "—";

    const parsed = dataTableSchema.parse(withDash);

    expect(parsed.tables[0]?.rows[2]?.[2]).toBe("—");
    expect(dataTableSchema.parse(nutrientPage).tables[0]?.rows[2]?.[2]).toBeNull();
  });

  it("rejects a ragged row, the failure that silently shifts every later column", () => {
    const ragged = structuredClone(nutrientPage);
    ragged.tables[0]!.rows[1] = ["Rozsliszt", "1350"]; // one cell short of 3

    const result = dataTableSchema.safeParse(ragged);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/row 2 has 2 cells but the table declares 3 columns/);
  });

  it("names the offending row in the error path, so a repair can be targeted", () => {
    const ragged = structuredClone(nutrientPage);
    ragged.tables[0]!.rows[0] = ["Búzaliszt"];

    const result = dataTableSchema.safeParse(ragged);

    expect(result.error?.issues[0]?.path).toEqual(["tables", 0, "rows", 0]);
  });

  it("accepts an unheaded first column, which most data tables have", () => {
    expect(nutrientPage.tables[0]?.columns[0]?.header).toBeNull();
    expect(dataTableSchema.safeParse(nutrientPage).success).toBe(true);
  });

  it("accepts a page whose tables are empty, rather than forcing invention", () => {
    const blank: DataTableDocument = {
      documentTitle: null,
      tables: [],
      notes: [],
      confidence: "low",
      warnings: ["The page is a photograph of a book spine; no table is visible."],
    };

    expect(dataTableSchema.safeParse(blank).success).toBe(true);
  });

  it("rejects a numeric cell, because cells are transcriptions", () => {
    const numeric = structuredClone(nutrientPage) as unknown as {
      tables: Array<{ rows: unknown[][] }>;
    };
    numeric.tables[0]!.rows[0]![1] = 1430;

    expect(dataTableSchema.safeParse(numeric).success).toBe(false);
  });
});
