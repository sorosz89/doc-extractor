import { describe, it, expect } from "vitest";
import {
  characterErrorRate,
  compareSlot,
  emptyTally,
  levenshtein,
  listMatch,
  normalizeProse,
  normalizeText,
  tallySlot,
} from "./text.js";

describe("normalizeText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeText("  12,5 \n g ")).toBe("12,5 g");
  });

  it("unifies Unicode composition, so ő typed two ways is one string", () => {
    const composed = "ő";
    const decomposed = "ő";
    expect(normalizeText(decomposed)).toBe(normalizeText(composed));
  });

  it("keeps what the page printed: dashes and decimal commas are not touched", () => {
    expect(normalizeText("—")).not.toBe(normalizeText("-"));
    expect(normalizeText("12,5")).not.toBe(normalizeText("12.5"));
  });
});

describe("normalizeProse", () => {
  it("drops heading and bullet markers, which are formatting, not words", () => {
    expect(normalizeProse("## Cím\n\n• első\n- második")).toBe("Cím első második");
  });

  it("does not drop a hyphen inside a line", () => {
    expect(normalizeProse("1-3 nap")).toBe("1-3 nap");
  });
});

describe("levenshtein", () => {
  it("counts single-character edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("counts an accented letter as one character", () => {
    expect(levenshtein("ő", "o")).toBe(1);
  });
});

describe("characterErrorRate", () => {
  it("is edits divided by the length of the truth", () => {
    expect(characterErrorRate("abcd", "abcx")).toBe(0.25);
  });

  it("is 0 when both are null and 1 when only one is", () => {
    expect(characterErrorRate(null, null)).toBe(0);
    expect(characterErrorRate("text", null)).toBe(1);
    expect(characterErrorRate(null, "invented")).toBe(1);
  });
});

describe("compareSlot", () => {
  it("separates the two kinds of null error", () => {
    expect(compareSlot(null, "2026-01-01")).toBe("invented");
    expect(compareSlot("2026-01-01", null)).toBe("omitted");
  });

  it("credits a correct null as its own outcome", () => {
    expect(compareSlot(null, null)).toBe("correctNull");
  });

  it("compares values after normalisation", () => {
    expect(compareSlot("12,5", " 12,5 ")).toBe("correct");
    expect(compareSlot("12,5", "12.5")).toBe("wrong");
  });

  it("treats a missing value (undefined) as null", () => {
    expect(compareSlot("x", undefined)).toBe("omitted");
  });
});

describe("tallySlot", () => {
  it("accumulates outcomes", () => {
    const tally = emptyTally();
    tallySlot(tally, compareSlot("a", "a"));
    tallySlot(tally, compareSlot(null, "b"));
    expect(tally).toEqual({ correct: 1, correctNull: 0, wrong: 0, invented: 1, omitted: 0 });
  });
});

describe("listMatch", () => {
  it("matches as a multiset, ignoring order", () => {
    expect(listMatch(["a", "b"], ["b", "a"])).toEqual({ expected: 2, actual: 2, matched: 2 });
  });

  it("counts extras and misses", () => {
    expect(listMatch(["a", "a"], ["a", "c", "d"])).toEqual({ expected: 2, actual: 3, matched: 1 });
  });
});
