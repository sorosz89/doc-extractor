import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { UsageMetadata } from "@langchain/core/messages";
import type { LoadedImage } from "../ingest/loadImage.js";
import { estimateCost, type Cost } from "../llm/cost.js";

/**
 * Milestone 1: one image in, free-text description out.
 *
 * This is deliberately the least useful thing the pipeline will ever do, and
 * the most instructive. Three concepts live in these few lines:
 *
 * 1. MULTIMODAL MESSAGES. A message's `content` is not a string, it is an
 *    ordered array of typed blocks. An image is just another block sitting
 *    beside the text. That ordering matters: the model reads the blocks in
 *    sequence, so image-then-question means it has looked at the page before
 *    it reads what you are asking.
 *
 * 2. NO OCR STAGE. We are not extracting characters and then reasoning over a
 *    text blob. The model's vision encoder turns the page into tokens directly,
 *    so layout, table structure, logo placement, and handwriting are all still
 *    present when it answers. A classical OCR pipeline throws most of that away
 *    at the first step and can never get it back.
 *
 * 3. IMAGES COST TOKENS. The response carries `usage_metadata`, and for a scan
 *    the input count is dominated by the image (~(w x h)/750 tokens). Printing
 *    it every run is how "resolution affects cost" stops being a slogan.
 */

/**
 * The model is a *parameter*, not something this function constructs.
 *
 * That one choice is what lets the test suite run with no API key and no
 * network: the test passes a stub. A function that reaches out and builds its
 * own client can only ever be tested by paying for it.
 */
export type InvokableModel = Pick<BaseChatModel, "invoke"> & {
  /** Model id, needed to price the call. ChatAnthropic exposes this. */
  model?: string;
};

export interface DescribeResult {
  /** What the model said about the page. */
  text: string;
  /** Token counts as reported by the API, or undefined if it reported none. */
  usage: UsageMetadata | undefined;
  /** Dollars, or undefined when the model is not in our price table. */
  cost: Cost | undefined;
}

const DESCRIBE_PROMPT = `Describe this scanned document.

Cover:
- What kind of document it is (table, form, letter, article, something else).
- Its overall layout: where the header, tables, text blocks, and signatures sit.
- Anything that would make automated extraction hard: skew, low contrast, handwriting, stamps, cropped edges, multiple columns.

Describe only what is visible. If something is unreadable, say it is unreadable rather than guessing at it.`;

export async function describeDocument(
  model: InvokableModel,
  image: LoadedImage,
): Promise<DescribeResult> {
  const message = new HumanMessage({
    content: [
      // Block 1: the page. `data` is raw base64 and `mimeType` tells the API
      // how to decode it — this is LangChain v1's provider-agnostic image
      // block, which it translates into Anthropic's native shape on the wire.
      {
        type: "image",
        mimeType: image.mimeType,
        data: image.base64,
      },
      // Block 2: the question, asked after the model has seen the page.
      {
        type: "text",
        text: DESCRIBE_PROMPT,
      },
    ],
  });

  const response = await model.invoke([message]);

  const usage = response.usage_metadata;
  const modelId = model.model;

  return {
    text: typeof response.text === "string" ? response.text : String(response.content),
    usage,
    cost: usage && modelId ? estimateCost(usage, modelId) : undefined,
  };
}
