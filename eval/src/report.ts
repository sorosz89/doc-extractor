import type { SampleRun } from "./runner.js";
import {
  emptyTally,
  inventionRate,
  omissionRate,
  tallyAccuracy,
  type SlotTally,
} from "./score/text.js";

/**
 * Turning runs into numbers you can compare across prompt changes.
 *
 * Every metric carries its direction, so a diff against a baseline can say
 * "better" or "worse" rather than just "different". A report that makes you
 * remember whether CER is good when it goes up is a report that gets misread.
 */

export type Direction = "higher" | "lower";

export interface Metric {
  value: number;
  better: Direction;
  format: "percent" | "usd" | "seconds" | "count";
}

export type Metrics = Record<string, Metric>;

export interface Summary {
  runs: number;
  byType: Record<string, Metrics>;
  overall: Metrics;
  /** Samples whose pass/fail differed between repeats: run-to-run noise. */
  unstable: string[];
  /** Runs where the model said "high" and the score said fail (lesson 3.2). */
  confidentFailures: string[];
}

const pct = (value: number, better: Direction): Metric => ({ value, better, format: "percent" });

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function share(runs: SampleRun[], predicate: (run: SampleRun) => boolean): number {
  return runs.length === 0 ? 0 : runs.filter(predicate).length / runs.length;
}

function addTally(into: SlotTally, from: SlotTally): void {
  for (const key of Object.keys(into) as (keyof SlotTally)[]) into[key] += from[key];
}

function tableMetrics(runs: Extract<SampleRun, { type: "table" }>[]): Metrics {
  const cells = emptyTally();
  const headers = emptyTally();
  let notesExpected = 0;
  let notesMatched = 0;
  for (const run of runs) {
    addTally(cells, run.score.cells);
    addTally(headers, run.score.headers);
    notesExpected += run.score.notes.expected;
    notesMatched += run.score.notes.matched;
  }
  return {
    "pass rate": pct(share(runs, (r) => r.pass), "higher"),
    "structure exact": pct(share(runs, (r) => r.type === "table" && r.score.structureExact), "higher"),
    "cell accuracy": pct(tallyAccuracy(cells), "higher"),
    "cells invented": pct(inventionRate(cells), "lower"),
    "cells omitted": pct(omissionRate(cells), "lower"),
    "header accuracy": pct(tallyAccuracy(headers), "higher"),
    "notes recall": pct(notesExpected === 0 ? 1 : notesMatched / notesExpected, "higher"),
  };
}

function proseMetrics(runs: Extract<SampleRun, { type: "prose" }>[]): Metrics {
  const fields = emptyTally();
  for (const run of runs) addTally(fields, run.score.fields.tally);
  const right = (o: string) => o === "correct" || o === "correctNull";
  return {
    "pass rate": pct(share(runs, (r) => r.pass), "higher"),
    "text CER (mean)": pct(mean(runs.map((r) => r.score.cer)), "lower"),
    "title right": pct(share(runs, (r) => r.type === "prose" && right(r.score.fields.title)), "higher"),
    "date right": pct(share(runs, (r) => r.type === "prose" && right(r.score.fields.date)), "higher"),
    "language right": pct(share(runs, (r) => r.type === "prose" && right(r.score.fields.language)), "higher"),
    "authors exact": pct(share(runs, (r) => r.type === "prose" && r.score.authorsExact), "higher"),
    "fields invented": pct(inventionRate(fields), "lower"),
    "fields omitted": pct(omissionRate(fields), "lower"),
  };
}

export function summarise(runs: SampleRun[]): Summary {
  const byType: Record<string, Metrics> = {};
  const tables = runs.filter((r): r is Extract<SampleRun, { type: "table" }> => r.type === "table");
  const proses = runs.filter((r): r is Extract<SampleRun, { type: "prose" }> => r.type === "prose");
  if (tables.length > 0) byType.table = tableMetrics(tables);
  if (proses.length > 0) byType.prose = proseMetrics(proses);

  const priced = runs.filter((r) => r.costUsd !== null);
  const overall: Metrics = {
    "pass rate": pct(share(runs, (r) => r.pass), "higher"),
    "cost / doc": { value: mean(priced.map((r) => r.costUsd ?? 0)), better: "lower", format: "usd" },
    "total cost": { value: priced.reduce((a, r) => a + (r.costUsd ?? 0), 0), better: "lower", format: "usd" },
    "latency / doc": { value: mean(runs.map((r) => r.latencyMs / 1000)), better: "lower", format: "seconds" },
    "input tokens / doc": { value: mean(runs.map((r) => r.inputTokens)), better: "lower", format: "count" },
    "output tokens / doc": { value: mean(runs.map((r) => r.outputTokens)), better: "lower", format: "count" },
  };

  const outcomes = new Map<string, Set<boolean>>();
  for (const run of runs) outcomes.set(run.name, (outcomes.get(run.name) ?? new Set()).add(run.pass));
  const unstable = [...outcomes].filter(([, seen]) => seen.size > 1).map(([name]) => name);

  const confidentFailures = runs
    .filter((r) => r.confidence === "high" && !r.pass)
    .map((r) => (r.attempt > 1 ? `${r.name} #${r.attempt}` : r.name));

  return { runs: runs.length, byType, overall, unstable, confidentFailures };
}

function formatValue(metric: Metric): string {
  switch (metric.format) {
    case "percent":
      return `${(metric.value * 100).toFixed(1)}%`;
    case "usd":
      return `$${metric.value.toFixed(4)}`;
    case "seconds":
      return `${metric.value.toFixed(1)}s`;
    case "count":
      return Math.round(metric.value).toLocaleString("en-US");
  }
}

function formatDelta(metric: Metric, before: Metric | undefined): string {
  if (!before) return "";
  const delta = metric.value - before.value;
  if (Math.abs(delta) < 1e-9) return "  =";
  const improved = metric.better === "higher" ? delta > 0 : delta < 0;
  const sign = delta > 0 ? "+" : "-";
  const magnitude = formatValue({ ...metric, value: Math.abs(delta) });
  return `  ${sign}${magnitude} ${improved ? "better" : "WORSE"}`;
}

function formatSection(title: string, metrics: Metrics, baseline: Metrics | undefined): string[] {
  const width = Math.max(...Object.keys(metrics).map((k) => k.length));
  return [
    `\n${title}`,
    ...Object.entries(metrics).map(
      ([name, metric]) =>
        `  ${name.padEnd(width)}  ${formatValue(metric).padStart(9)}${formatDelta(metric, baseline?.[name])}`,
    ),
  ];
}

function sampleLine(run: SampleRun): string {
  const name = run.attempt > 1 ? `${run.name} #${run.attempt}` : run.name;
  const detail =
    run.type === "table"
      ? `cells ${(run.score.cellAccuracy * 100).toFixed(1)}%${run.score.structureExact ? "" : ` · ${run.score.structureIssues.join("; ")}`}`
      : `CER ${(run.score.cer * 100).toFixed(2)}% · title ${run.score.fields.title} · date ${run.score.fields.date} · authors ${run.score.authorsExact ? "exact" : `${run.score.authors.matched}/${run.score.authors.expected} (+${run.score.authors.actual - run.score.authors.matched})`}`;
  const failure = run.validationError ? ` · INVALID` : "";
  return `  ${run.pass ? "PASS" : "FAIL"}  ${name} [${run.type}] ${detail}${failure} · confidence ${run.confidence ?? "-"}`;
}

export function formatReport(runs: SampleRun[], summary: Summary, baseline?: Summary): string {
  const lines = ["\nSamples", ...runs.map(sampleLine)];
  for (const [type, metrics] of Object.entries(summary.byType)) {
    lines.push(...formatSection(`${type} (${runs.filter((r) => r.type === type).length} runs)`, metrics, baseline?.byType[type]));
  }
  lines.push(...formatSection(`overall (${summary.runs} runs)`, summary.overall, baseline?.overall));

  if (summary.unstable.length > 0) {
    lines.push(`\nUnstable across repeats: ${summary.unstable.join(", ")}`);
  }
  if (summary.confidentFailures.length > 0) {
    lines.push(`High confidence, failed anyway: ${summary.confidentFailures.join(", ")}`);
  }
  return lines.join("\n");
}
