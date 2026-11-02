import { describe, it, expect, vi } from "vitest";
import { AIMessage, type StandardMessageStructure } from "@langchain/core/messages";
import type { StructuringModel } from "../../src/extract/extractDocument.js";
import type { LoadedImage } from "../../src/ingest/loadImage.js";
import { runSample } from "./runner.js";
import type { Sample } from "./dataset.js";

const image: LoadedImage = { base64: "QUJD", mimeType: "image/png", bytes: 3, filename: "p.png" };

const sample: Sample = {
  name: "letter",
  imagePath: "/dev/null/p.png",
  truthPath: "/dev/null/letter.truth.json",
  type: "prose",
  expected: { title: null, language: "hu", date: null, authors: [], text: "Kedves Péter!" },
};

function stubModel(args: Record<string, unknown>): StructuringModel {
  const raw = new AIMessage<StandardMessageStructure>({
    content: "",
    tool_calls: [{ name: "transcribe_document", args, id: "t1" }],
    usage_metadata: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 },
  });
  return {
    model: "claude-sonnet-5",
    withStructuredOutput: vi.fn().mockReturnValue({ invoke: vi.fn().mockResolvedValue({ raw, parsed: args }) }),
  };
}

const deps = (() => {
  let t = 0;
  return { loadImage: async () => image, now: () => (t += 250) };
})();

describe("runSample", () => {
  it("extracts, scores, and records tokens, cost, latency and confidence", async () => {
    const answer = {
      title: null,
      documentKind: "letter",
      language: "hu",
      date: null,
      authors: [],
      text: "Kedves Péter!",
      confidence: "high",
      warnings: [],
    };

    const run = await runSample(stubModel(answer), sample, 1, deps);

    expect(run.pass).toBe(true);
    expect(run.inputTokens).toBe(1000);
    expect(run.costUsd).toBeCloseTo(0.003);
    expect(run.latencyMs).toBe(250);
    expect(run.confidence).toBe("high");
  });

  it("scores an answer that failed validation as a failed read, and keeps the reason", async () => {
    const run = await runSample(stubModel({ text: "" }), sample, 1, deps);

    expect(run.pass).toBe(false);
    expect(run.validationError).toMatch(/title/);
    expect(run.extracted).toBeNull();
  });
});
