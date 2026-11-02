import { describe, it, expect, vi } from "vitest";
import { AIMessage, HumanMessage, type StandardMessageStructure } from "@langchain/core/messages";
import { extractDocument, type StructuringModel } from "./extractDocument.js";
import { invoiceSchema, type Invoice } from "../schemas/invoice.js";
import type { DocumentType } from "../schemas/registry.js";
import type { LoadedImage } from "../ingest/loadImage.js";

/**
 * A document type defined here rather than taken from the registry.
 *
 * This file tests the extraction *mechanism*, so it should not break when the
 * registry's contents change — which they do, as the project learns what kinds
 * of document it actually handles. `invoiceSchema` is the worked example from
 * the learning log and serves perfectly well as a fixture.
 */
const invoiceType: DocumentType<typeof invoiceSchema> = {
  key: "invoice",
  label: "invoice",
  toolName: "record_invoice",
  schema: invoiceSchema,
};

const image: LoadedImage = {
  base64: "QUJD",
  mimeType: "image/png",
  bytes: 3,
  filename: "invoice.png",
};

const invoice: Invoice = {
  invoiceNumber: "2026/114",
  issueDate: "2026-10-01",
  dueDate: null,
  seller: { name: "Acme Kft.", address: null, taxId: null },
  buyer: { name: "Globex Ltd.", address: null, taxId: null },
  currency: "HUF",
  lineItems: [],
  subtotal: null,
  taxAmount: null,
  total: 127_000,
  confidence: "high",
  warnings: [],
};

/**
 * A stub standing in for `ChatAnthropic.withStructuredOutput(...)`.
 *
 * The whole suite runs with no API key, no network, and no spend — which is
 * only possible because `extractDocument` takes the model as a parameter. It
 * also lets us assert on the *tool definition* that would have been sent, which
 * is the part of structured output that actually constrains the model and the
 * part no end-to-end run would show us.
 */
function stubModel(raw: AIMessage, parsed: unknown, modelId = "claude-sonnet-5") {
  const invoke = vi.fn().mockResolvedValue({ raw, parsed });
  const withStructuredOutput = vi.fn().mockReturnValue({ invoke });

  return {
    model: { model: modelId, withStructuredOutput } satisfies StructuringModel,
    withStructuredOutput,
    invoke,
  };
}

/** An assistant turn that called the tool, which is what a success looks like. */
function toolCallReply(args: Record<string, unknown>, input = 4_200, output = 700): AIMessage {
  return new AIMessage<StandardMessageStructure>({
    content: "",
    tool_calls: [{ id: "toolu_1", name: "record_invoice", args }],
    usage_metadata: { input_tokens: input, output_tokens: output, total_tokens: input + output },
  });
}

describe("extractDocument", () => {
  it("declares the schema as a forced tool, named by the registry", async () => {
    const { model, withStructuredOutput } = stubModel(toolCallReply({ ...invoice }), invoice);

    await extractDocument(model, image, invoiceType);

    expect(withStructuredOutput).toHaveBeenCalledWith(invoiceSchema, {
      name: "record_invoice",
      // Not cosmetic: without the raw message there is no usage_metadata, and
      // therefore no token count and no cost for the call.
      includeRaw: true,
    });
  });

  it("sends the image and the instruction as two blocks, image first", async () => {
    const { model, invoke } = stubModel(toolCallReply({ ...invoice }), invoice);

    await extractDocument(model, image, invoiceType);

    const [messages] = vi.mocked(invoke).mock.calls[0]!;
    const blocks = (messages as HumanMessage[])[0]!.content as Array<Record<string, unknown>>;

    expect(blocks[0]).toEqual({ type: "image", mimeType: "image/png", data: "QUJD" });
    expect(blocks[1]?.type).toBe("text");
    expect(blocks[1]?.text).toContain("scanned invoice");
    // The null-instead-of-guess instruction is load-bearing from here on.
    expect(blocks[1]?.text).toMatch(/return null rather than a plausible value/);
  });

  it("returns the validated document with its usage and cost", async () => {
    const { model } = stubModel(toolCallReply({ ...invoice }, 4_200, 700), invoice);

    const result = await extractDocument(model, image, invoiceType);

    expect(result.data?.invoiceNumber).toBe("2026/114");
    expect(result.validationError).toBeUndefined();
    expect(result.usage?.input_tokens).toBe(4_200);
    expect(result.cost?.totalUsd).toBeCloseTo((4_200 / 1e6) * 2 + (700 / 1e6) * 10, 10);
  });

  it("turns LangChain's silent null into an error that names the bad field", async () => {
    // What a real validation failure looks like: LangChain's own parse failed,
    // so `parsed` is null and the only record of what the model said is the
    // raw tool call. Reporting "null" here would be useless; milestone 7 needs
    // the field and the reason to feed back to the model.
    const badArgs = { ...invoice, issueDate: "01/10/2026" };
    const { model } = stubModel(toolCallReply(badArgs), null);

    const result = await extractDocument(model, image, invoiceType);

    expect(result.data).toBeUndefined();
    expect(result.validationError).toMatch(/issueDate/);
    expect(result.validationError).toMatch(/ISO date/);
  });

  it("still reports usage and cost when validation fails, because the call was still billed", async () => {
    const { model } = stubModel(toolCallReply({ ...invoice, total: "127000" }), null);

    const result = await extractDocument(model, image, invoiceType);

    expect(result.data).toBeUndefined();
    expect(result.usage?.total_tokens).toBe(4_900);
    expect(result.cost?.totalUsd).toBeGreaterThan(0);
  });

  it("says so plainly when the model answered without calling the tool at all", async () => {
    const refusal = new AIMessage<StandardMessageStructure>({
      content: "I cannot read this document.",
      usage_metadata: { input_tokens: 4_200, output_tokens: 12, total_tokens: 4_212 },
    });
    const { model } = stubModel(refusal, null);

    const result = await extractDocument(model, image, invoiceType);

    expect(result.data).toBeUndefined();
    expect(result.validationError).toMatch(/no tool call/);
  });

  it("leaves cost undefined for a model that is not priced", async () => {
    const { model } = stubModel(toolCallReply({ ...invoice }), invoice, "some-other-model");

    const result = await extractDocument(model, image, invoiceType);

    expect(result.usage).toBeDefined();
    expect(result.cost).toBeUndefined();
  });
});
