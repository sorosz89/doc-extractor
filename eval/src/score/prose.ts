import type { ProseTruth } from "../truth.js";
import {
  characterErrorRate,
  compareSlot,
  emptyTally,
  isExactListMatch,
  listMatch,
  tallySlot,
  type ListMatch,
  type SlotOutcome,
  type SlotTally,
} from "./text.js";

/** Document passes at or below this character error rate. A starting guess. */
export const PROSE_PASS_MAX_CER = 0.02;

export interface ProseScore {
  fields: {
    title: SlotOutcome;
    date: SlotOutcome;
    language: SlotOutcome;
    tally: SlotTally;
  };
  authors: ListMatch;
  authorsExact: boolean;
  /** Character error rate of `text`, after forgiving markup. */
  cer: number;
  pass: boolean;
}

/**
 * Score a transcription against ground truth.
 *
 * Two different kinds of measurement live side by side here:
 *
 *  - The metadata fields are *slots*: right, wrong, or one of the two null
 *    errors. A page with no printed date is a null-correctness test — any date
 *    the model returns is invented.
 *  - The text is a *string*: it is never exactly right on a real page, so it
 *    gets a rate (CER), not a verdict. The verdict comes from a threshold.
 */
export function scoreProse(expected: ProseTruth, actual: ProseTruth | undefined): ProseScore {
  const title = compareSlot(expected.title, actual?.title);
  const date = compareSlot(expected.date, actual?.date);
  const language = compareSlot(expected.language, actual?.language, (value) => value.trim().toLowerCase());

  const tally = emptyTally();
  for (const outcome of [title, date, language]) tallySlot(tally, outcome);

  const authors = listMatch(expected.authors, actual?.authors ?? []);
  const authorsExact = isExactListMatch(authors);
  const cer = characterErrorRate(expected.text, actual?.text ?? null);

  const fieldsRight = [title, date, language].every((o) => o === "correct" || o === "correctNull");

  return {
    fields: { title, date, language, tally },
    authors,
    authorsExact,
    cer,
    pass: fieldsRight && authorsExact && cer <= PROSE_PASS_MAX_CER,
  };
}
