import { describe, it, expect } from "vitest";
import type { UsageMetadata } from "@langchain/core/messages";
import { estimateCost, formatUsd, isKnownModel, PRICES } from "./cost.js";

const usage = (input: number, output: number): UsageMetadata => ({
  input_tokens: input,
  output_tokens: output,
  total_tokens: input + output,
});

describe("estimateCost", () => {
  it("prices input and output at different rates", () => {
    // 1M input + 1M output on Sonnet 5 = $2 + $10.
    const cost = estimateCost(usage(1_000_000, 1_000_000), "claude-sonnet-5");

    expect(cost).toEqual({ inputUsd: 2, outputUsd: 10, totalUsd: 12 });
  });

  it("prices a realistic single-page extraction in fractions of a cent", () => {
    // ~4,200 image tokens for a 1536x2048 scan, plus a short answer.
    const cost = estimateCost(usage(4_500, 600), "claude-sonnet-5");

    expect(cost?.totalUsd).toBeCloseTo(0.000009 * 1000 + 0.000006 * 1000, 10);
    expect(cost!.totalUsd).toBeLessThan(0.02);
    // The input side dominates: that is the image.
    expect(cost!.inputUsd).toBeGreaterThan(cost!.outputUsd);
  });

  it("charges the Haiku classifier less than the Sonnet extractor for identical usage", () => {
    const sonnet = estimateCost(usage(4_000, 200), "claude-sonnet-5");
    const haiku = estimateCost(usage(4_000, 200), "claude-haiku-4-5");

    expect(haiku!.totalUsd).toBeLessThan(sonnet!.totalUsd);
  });

  it("returns undefined for an unpriced model rather than reporting $0", () => {
    expect(estimateCost(usage(100, 100), "claude-3-opus-20240229")).toBeUndefined();
  });

  it("is free when nothing was used", () => {
    expect(estimateCost(usage(0, 0), "claude-sonnet-5")?.totalUsd).toBe(0);
  });
});

describe("isKnownModel", () => {
  it("recognises every model in the price table", () => {
    for (const model of Object.keys(PRICES)) {
      expect(isKnownModel(model)).toBe(true);
    }
  });

  it("rejects an unknown id", () => {
    expect(isKnownModel("gpt-4")).toBe(false);
  });
});

describe("formatUsd", () => {
  it("keeps enough precision to show a single-page cost", () => {
    expect(formatUsd(0.00123)).toBe("$0.00123");
  });
});
