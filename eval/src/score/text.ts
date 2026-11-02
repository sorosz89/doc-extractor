/**
 * Text primitives every scorer shares.
 *
 * WHAT NORMALISATION IS ALLOWED TO FORGIVE
 *
 * A scorer has to decide which differences count. Too strict, and the eval
 * reports noise — two spaces instead of one, or `ő` stored as `o` plus a
 * combining accent, would be "wrong" though the page reads the same. Too
 * lenient, and it hides exactly the errors it exists to find.
 *
 * The line here: forgive *encoding* (whitespace, Unicode composition), never
 * *content*. `—` vs `-` and `12,5` vs `12.5` stay errors, because the schema
 * promises the cell exactly as printed, and an eval that forgave them would
 * be grading a promise the pipeline does not make.
 */

export function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * For transcriptions, additionally forgive *markup*: the `## ` heading prefix
 * and list bullets. They are formatting choices the schema allows, not words
 * the model read — character error rate should measure reading.
 */
export function normalizeProse(value: string): string {
  return normalizeText(
    value
      .normalize("NFC")
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*[•\-*–][ \t]+/gm, ""),
  );
}

/** Edit distance over code points, so an accented letter is one character. */
export function levenshtein(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

/**
 * Character error rate: edits needed to turn the output into the truth,
 * divided by the length of the truth. The standard OCR metric, and the right
 * one for a transcription — a single wrong letter in a 3,000-character page
 * is a rounding error, a dropped paragraph is not.
 *
 * Can exceed 1 when the output is much longer than the truth.
 */
export function characterErrorRate(expected: string | null, actual: string | null): number {
  if (expected === null && actual === null) return 0;
  if (expected === null || actual === null) return 1;
  const truth = normalizeProse(expected);
  return levenshtein(truth, normalizeProse(actual)) / Math.max([...truth].length, 1);
}

/**
 * The five things that can happen to one nullable slot.
 *
 * Accuracy alone folds the two null errors together, and they are opposite
 * failures: `invented` is hallucination (the page is blank, the model wrote
 * something), `omitted` is under-reading (the page has it, the model said
 * null). Counting them separately is what "null-correctness" means.
 */
export type SlotOutcome = "correct" | "correctNull" | "wrong" | "invented" | "omitted";

export function compareSlot(
  expected: string | null,
  actual: string | null | undefined,
  normalize: (value: string) => string = normalizeText,
): SlotOutcome {
  const got = actual ?? null;
  if (expected === null) return got === null ? "correctNull" : "invented";
  if (got === null) return "omitted";
  return normalize(expected) === normalize(got) ? "correct" : "wrong";
}

export type SlotTally = Record<SlotOutcome, number>;

export function emptyTally(): SlotTally {
  return { correct: 0, correctNull: 0, wrong: 0, invented: 0, omitted: 0 };
}

export function tallySlot(tally: SlotTally, outcome: SlotOutcome): void {
  tally[outcome] += 1;
}

export function tallyTotal(tally: SlotTally): number {
  return tally.correct + tally.correctNull + tally.wrong + tally.invented + tally.omitted;
}

/** Share of slots right, nulls included. */
export function tallyAccuracy(tally: SlotTally): number {
  const total = tallyTotal(tally);
  return total === 0 ? 1 : (tally.correct + tally.correctNull) / total;
}

/** Of the slots the page left blank, the share the model filled anyway. */
export function inventionRate(tally: SlotTally): number {
  const blanks = tally.correctNull + tally.invented;
  return blanks === 0 ? 0 : tally.invented / blanks;
}

/** Of the slots the page filled, the share the model returned as null. */
export function omissionRate(tally: SlotTally): number {
  const filled = tally.correct + tally.wrong + tally.omitted;
  return filled === 0 ? 0 : tally.omitted / filled;
}

export interface ListMatch {
  expected: number;
  actual: number;
  matched: number;
}

/** Lists with no meaningful order (authors, footnotes): multiset overlap. */
export function listMatch(expected: readonly string[], actual: readonly string[]): ListMatch {
  const remaining = new Map<string, number>();
  for (const item of expected.map(normalizeText)) remaining.set(item, (remaining.get(item) ?? 0) + 1);

  let matched = 0;
  for (const item of actual.map(normalizeText)) {
    const count = remaining.get(item) ?? 0;
    if (count > 0) {
      matched += 1;
      remaining.set(item, count - 1);
    }
  }
  return { expected: expected.length, actual: actual.length, matched };
}

export function isExactListMatch(match: ListMatch): boolean {
  return match.matched === match.expected && match.matched === match.actual;
}
