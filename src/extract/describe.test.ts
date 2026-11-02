import { describe, it, expect, vi } from "vitest";
import { AIMessage, HumanMessage, type StandardMessageStructure } from "@langchain/core/messages";
import { describeDocument, type InvokableModel } from "./describe.js";
import type { LoadedImage } from "../ingest/loadImage.js";

const image: LoadedImage = {
  base64: "QUJD",
  mimeType: "image/png",
  bytes: 3,
  filename: "scan.png",
};

/**
 * A stub standing in for ChatAnthropic.
 *
 * This is why `describeDocument` takes the model as a parameter: the whole
 * suite runs with no API key, no network, and no spend.
 */
function stubModel(response: AIMessage, model = "claude-sonnet-5"): InvokableModel {
  return { invoke: vi.fn().mockResolvedValue(response), model } as unknown as InvokableModel;
}

const reply = (text: string, input = 4_200, output = 300) =>
  new AIMessage<StandardMessageStructure>({
    content: text,
    usage_metadata: { input_tokens: input, output_tokens: output, total_tokens: input + output },
  });

describe("describeDocument", () => {
  it("sends the image and the question as two content blocks, image first", async () => {
    const model = stubModel(reply("A skewed letter."));

    await describeDocument(model, image);

    const [messages] = vi.mocked(model.invoke).mock.calls[0]!;
    const message = (messages as HumanMessage[])[0]!;
    const blocks = message.content as Array<Record<string, unknown>>;

    expect(blocks).toHaveLength(2);
    // Order is not cosmetic: the model reads blocks in sequence, so it should
    // see the page before it reads the question about the page.
    expect(blocks[0]).toEqual({ type: "image", mimeType: "image/png", data: "QUJD" });
    expect(blocks[1]?.type).toBe("text");
    expect(blocks[1]?.text).toContain("Describe this scanned document");
  });

  it("instructs the model to admit unreadable content instead of guessing", async () => {
    const model = stubModel(reply("ok"));

    await describeDocument(model, image);

    const [messages] = vi.mocked(model.invoke).mock.calls[0]!;
    const blocks = (messages as HumanMessage[])[0]!.content as Array<Record<string, string>>;

    // The anti-hallucination instruction is load-bearing from milestone 4 on.
    expect(blocks[1]?.text).toMatch(/unreadable rather than guessing/);
  });

  it("returns the text, the usage, and the cost derived from them", async () => {
    const result = await describeDocument(stubModel(reply("A receipt.", 4_200, 300)), image);

    expect(result.text).toBe("A receipt.");
    expect(result.usage?.input_tokens).toBe(4_200);
    expect(result.cost?.totalUsd).toBeCloseTo((4_200 / 1e6) * 2 + (300 / 1e6) * 10, 10);
  });

  it("leaves cost undefined when the API reported no usage", async () => {
    const model = stubModel(new AIMessage({ content: "no usage here" }));

    const result = await describeDocument(model, image);

    expect(result.usage).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });

  it("leaves cost undefined for a model that is not priced", async () => {
    const result = await describeDocument(stubModel(reply("x"), "some-other-model"), image);

    expect(result.usage).toBeDefined();
    expect(result.cost).toBeUndefined();
  });
});
