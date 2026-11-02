import type { TableTruth } from "../truth.js";
import {
  compareSlot,
  emptyTally,
  listMatch,
  tallyAccuracy,
  tallySlot,
  type ListMatch,
  type SlotTally,
} from "./text.js";

/** Document passes at this share of cells right, with structure exact. A starting guess. */
export const TABLE_PASS_CELL_ACCURACY = 0.98;

export interface TableScore {
  /** Same number of tables, and per table the same column and row counts. */
  structureExact: boolean;
  structureIssues: string[];
  /** Document title, table titles, column headers and units. */
  headers: SlotTally;
  cells: SlotTally;
  cellAccuracy: number;
  /** Footnotes and notes, matched as multisets. */
  notes: ListMatch;
  pass: boolean;
}

type Table = TableTruth["tables"][number];

/**
 * Score a table extraction against ground truth.
 *
 * ALIGNMENT IS BY POSITION, ON PURPOSE
 *
 * Row 3 of the output is compared with row 3 of the truth, cell for cell. The
 * alternative — matching rows by their label — would be kinder to a single
 * missing row, which otherwise fails every row below it. But that kindness
 * would hide the failure this eval exists to find: a value that drifted into
 * the neighbouring row (`course.md` lesson 3.1) is only visible if position
 * is what is being checked.
 *
 * `actual` is undefined when the extraction failed validation; it then scores
 * as a page where the model read nothing, which is what the user got.
 */
export function scoreTable(expected: TableTruth, actual: TableTruth | undefined): TableScore {
  const structureIssues: string[] = [];
  const headers = emptyTally();
  const cells = emptyTally();

  const got = actual ?? { documentTitle: null, tables: [], notes: [] };

  tallySlot(headers, compareSlot(expected.documentTitle, got.documentTitle));

  if (expected.tables.length !== got.tables.length) {
    structureIssues.push(`expected ${expected.tables.length} tables, got ${got.tables.length}`);
  }

  const tableCount = Math.max(expected.tables.length, got.tables.length);
  for (let t = 0; t < tableCount; t++) {
    scoreOneTable(t, expected.tables[t], got.tables[t], headers, cells, structureIssues);
  }

  const notes = listMatch(
    [...expected.notes, ...expected.tables.flatMap((table) => table.footnotes)],
    [...got.notes, ...got.tables.flatMap((table) => table.footnotes)],
  );

  const cellAccuracy = tallyAccuracy(cells);
  const structureExact = structureIssues.length === 0;

  return {
    structureExact,
    structureIssues,
    headers,
    cells,
    cellAccuracy,
    notes,
    pass: structureExact && cellAccuracy >= TABLE_PASS_CELL_ACCURACY,
  };
}

function scoreOneTable(
  index: number,
  expected: Table | undefined,
  actual: Table | undefined,
  headers: SlotTally,
  cells: SlotTally,
  issues: string[],
): void {
  const label = `table ${index + 1}`;

  if (expected) tallySlot(headers, compareSlot(expected.title, actual?.title));

  const expectedColumns = expected?.columns ?? [];
  const actualColumns = actual?.columns ?? [];
  if (expected && actual && expectedColumns.length !== actualColumns.length) {
    issues.push(`${label}: expected ${expectedColumns.length} columns, got ${actualColumns.length}`);
  }
  for (const [c, column] of expectedColumns.entries()) {
    tallySlot(headers, compareSlot(column.header, actualColumns[c]?.header));
    tallySlot(headers, compareSlot(column.unit, actualColumns[c]?.unit));
  }

  const expectedRows = expected?.rows ?? [];
  const actualRows = actual?.rows ?? [];
  if (expected && actual && expectedRows.length !== actualRows.length) {
    issues.push(`${label}: expected ${expectedRows.length} rows, got ${actualRows.length}`);
  }

  const rowCount = Math.max(expectedRows.length, actualRows.length);
  for (let r = 0; r < rowCount; r++) {
    const expectedRow = expectedRows[r];
    const actualRow = actualRows[r] ?? [];

    if (expectedRow === undefined) {
      // A row the page does not have. Its filled cells are invented; its blank
      // cells claim nothing, so they are not counted either way.
      for (const value of actualRow) if (value !== null) tallySlot(cells, "invented");
      continue;
    }

    for (const [c, value] of expectedRow.entries()) {
      tallySlot(cells, compareSlot(value, actualRow[c]));
    }
    for (const extra of actualRow.slice(expectedRow.length)) {
      if (extra !== null) tallySlot(cells, "invented");
    }
  }
}
