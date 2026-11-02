import { describe, it, expect } from "vitest";
import { scoreProse } from "./prose.js";
import type { ProseTruth } from "../truth.js";

const truth: ProseTruth = {
  title: "Fitoösztrogének",
  language: "hu",
  date: "2022-09-24",
  authors: ["Dr. Fáklya Mónika"],
  text: "## Fitoösztrogének\n\nA fitoösztrogének olyan növényi eredetű vegyületek gyűjtőneve.",
};

describe("scoreProse", () => {
  it("passes a perfect transcription", () => {
    const score = scoreProse(truth, { ...truth });
    expect(score.cer).toBe(0);
    expect(score.pass).toBe(true);
  });

  it("forgives markup but not words", () => {
    const relaid = { ...truth, text: "Fitoösztrogének\nA fitoösztrogének olyan növényi eredetű vegyületek gyűjtőneve." };
    expect(scoreProse(truth, relaid).cer).toBe(0);
  });

  it("flags an invented date on a page that has none", () => {
    const undated = { ...truth, date: null };
    const score = scoreProse(undated, { ...truth, date: "2024-01-01" });
    expect(score.fields.date).toBe("invented");
    expect(score.fields.tally.invented).toBe(1);
    expect(score.pass).toBe(false);
  });

  it("requires the exact author set", () => {
    const score = scoreProse(truth, { ...truth, authors: ["Dr. Fáklya Mónika, endokrinológus"] });
    expect(score.authorsExact).toBe(false);
    expect(score.pass).toBe(false);
  });

  it("fails above the CER threshold", () => {
    const sloppy = { ...truth, text: "## Fitoösztrogének\n\nA fitoösztrogének növényi vegyületek." };
    const score = scoreProse(truth, sloppy);
    expect(score.cer).toBeGreaterThan(0.02);
    expect(score.pass).toBe(false);
  });

  it("scores a failed extraction as everything omitted", () => {
    const score = scoreProse(truth, undefined);
    expect(score.cer).toBe(1);
    expect(score.fields.tally.omitted).toBe(3);
    expect(score.pass).toBe(false);
  });
});
