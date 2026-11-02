import { describe, it, expect } from "vitest";
import { scoreTable } from "./table.js";
import type { TableTruth } from "../truth.js";

const truth: TableTruth = {
  documentTitle: "Tápanyagtáblázat",
  tables: [
    {
      title: null,
      columns: [
        { header: null, unit: null },
        { header: "Energia", unit: "kJ" },
        { header: "Magnézium", unit: "mg" },
      ],
      rows: [
        ["Kenyér", "1000", "35,0"],
        ["Kifli", "1100", null],
        ["Zsemle", "1050", "-"],
      ],
      footnotes: [],
    },
  ],
  notes: ["Gabonafélék"],
};

function clone(value: TableTruth): TableTruth {
  return structuredClone(value);
}

describe("scoreTable", () => {
  it("passes a perfect extraction", () => {
    const score = scoreTable(truth, clone(truth));
    expect(score.cellAccuracy).toBe(1);
    expect(score.structureExact).toBe(true);
    expect(score.pass).toBe(true);
  });

  it("catches the drift from lesson 3.1: a value shifted down a row", () => {
    const drifted = clone(truth);
    drifted.tables[0]!.rows[0]![2] = null;
    drifted.tables[0]!.rows[1]![2] = "35,0";

    const score = scoreTable(truth, drifted);
    expect(score.structureExact).toBe(true);
    expect(score.cells.omitted).toBe(1);
    expect(score.cells.invented).toBe(1);
    expect(score.pass).toBe(false);
  });

  it("does not forgive a dash written as a different dash", () => {
    const dashed = clone(truth);
    dashed.tables[0]!.rows[2]![2] = "—";
    expect(scoreTable(truth, dashed).cells.wrong).toBe(1);
  });

  it("reports a missing row as a structure failure and its cells as omitted", () => {
    const short = clone(truth);
    short.tables[0]!.rows.pop();

    const score = scoreTable(truth, short);
    expect(score.structureExact).toBe(false);
    expect(score.structureIssues).toContain("table 1: expected 3 rows, got 2");
    expect(score.cells.omitted).toBe(3);
  });

  it("counts filled cells in an extra row as invented", () => {
    const long = clone(truth);
    long.tables[0]!.rows.push(["Pogácsa", "1200", null]);

    const score = scoreTable(truth, long);
    expect(score.cells.invented).toBe(2);
    expect(score.structureExact).toBe(false);
  });

  it("scores headers and units separately from cells", () => {
    const renamed = clone(truth);
    renamed.tables[0]!.columns[1]!.header = "Energy";
    const score = scoreTable(truth, renamed);
    expect(score.headers.wrong).toBe(1);
    expect(score.cellAccuracy).toBe(1);
  });

  it("scores a failed extraction as everything omitted", () => {
    const score = scoreTable(truth, undefined);
    expect(score.pass).toBe(false);
    expect(score.cells.omitted).toBe(8);
    expect(score.cells.correctNull).toBe(1);
  });
});
