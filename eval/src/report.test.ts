import { describe, it, expect } from "vitest";
import { formatReport, summarise } from "./report.js";
import type { SampleRun } from "./runner.js";
import { scoreProse } from "./score/prose.js";

const truth = { title: null, language: "hu", date: null, authors: [], text: "abcdefghij" };

function proseRun(name: string, text: string, attempt = 1, confidence = "high"): SampleRun {
  const score = scoreProse(truth, { ...truth, text });
  return {
    name,
    attempt,
    type: "prose",
    score,
    pass: score.pass,
    latencyMs: 2000,
    inputTokens: 1000,
    outputTokens: 100,
    costUsd: 0.003,
    validationError: null,
    confidence,
    warnings: [],
    extracted: null,
  };
}

describe("summarise", () => {
  it("aggregates pass rate, CER and cost", () => {
    const summary = summarise([proseRun("a", "abcdefghij"), proseRun("b", "abcdefghiX")]);
    expect(summary.byType.prose?.["pass rate"]?.value).toBe(0.5);
    expect(summary.byType.prose?.["text CER (mean)"]?.value).toBeCloseTo(0.05);
    expect(summary.overall["total cost"]?.value).toBeCloseTo(0.006);
  });

  it("names samples whose result changed between repeats", () => {
    const summary = summarise([proseRun("a", "abcdefghij", 1), proseRun("a", "abcdefXhij", 2)]);
    expect(summary.unstable).toEqual(["a"]);
  });

  it("names confident failures", () => {
    const summary = summarise([proseRun("a", "XXXXXXXXXX", 1, "high"), proseRun("b", "XXXXXXXXXX", 1, "low")]);
    expect(summary.confidentFailures).toEqual(["a"]);
  });
});

describe("formatReport", () => {
  it("marks a change against the baseline as better or worse, by the metric's direction", () => {
    const before = summarise([proseRun("a", "abcdefghXX")]);
    const runs = [proseRun("a", "abcdefghij")];
    const report = formatReport(runs, summarise(runs), before);
    expect(report).toMatch(/text CER \(mean\)\s+0\.0%\s+-20\.0% better/);
  });
});
