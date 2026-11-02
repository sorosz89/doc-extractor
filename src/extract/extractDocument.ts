import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import type { z } from "zod";
import type { LoadedImage } from "../ingest/loadImage.js";
import { estimateCost, type Cost } from "../llm/cost.js";
import type { DocumentType } from "../schemas/registry.js";

/**
 * Milestone 2: one image in, validated typed JSON out.
 *
 * Milestone 1 asked the model to describe a page and printed the paragraph it
 * wrote back. That is a dead end — prose cannot be validated, diffed against
 * ground truth, or passed to anything downstream. This is the step where the
 * pipeline starts producing an actual output.
 *
 * THE MECHANISM: STRUCTURED OUTPUT IS TOOL CALLING
 *
 * The naive approach is to ask for JSON in the prompt and parse the reply. It
 * mostly works, which is the problem: it fails on the documents you care about,
 * by wrapping the JSON in a markdown fence, by adding "Here is the JSON you
 * asked for", by trailing a comma, or by inventing a field name.
 *
 * `withStructuredOutput()` does something categorically different. It converts
 * the Zod schema to JSON Schema, declares it as a *tool* the model can call,
 * and sets `tool_choice` to that tool — which means the model is not asked for
 * JSON, it is required to call a function whose arguments are the fields.
 * Emitting the schema's shape is the only move available to it. Argument
 * generation is constrained by the API rather than requested in prose, so the
 * whole category of "it replied with a sentence and then the JSON" disappears.
 *
 * This is why `src/schemas/` is the most important directory in the project:
 * the schema is simultaneously the type, the validator, and the prompt.
 *
 * WHY `includeRaw: true`
 *
 * By default `withStructuredOutput()` returns only the parsed object. That is
 * the obvious thing to want and it throws away the `AIMessage` — and with it
 * `usage_metadata`, so there would be no token counts and no cost. This project
 * prints those on every run (see milestone 1's notes on why), so we ask for
 * `{ raw, parsed }` and read usage off the raw message.
 *
 * WHY THE SCHEMA IS APPLIED TWICE
 *
 * With `includeRaw: true`, a Zod validation failure does not throw: LangChain
 * swallows it and sets `parsed` to `null` (`@langchain/core`'s
 * `assembleStructuredOutputPipeline`). A silent null is a bad failure mode —
 * "the model returned nothing" and "the model returned a date in the wrong
 * format" need different responses.
 *
 * So we run `safeParse` ourselves on the tool call's arguments. On the happy
 * path that is a redundant validation costing microseconds; when something is
 * wrong it is the difference between `null` and "issueDate: expected an ISO
 * date, YYYY-MM-DD". That message is exactly what milestone 7's repair loop
 * feeds back to the model, so this function already produces it.
 */

/** What `withStructuredOutput(..., { includeRaw: true })` resolves to. */
export interface StructuredOutputRunnable {
  invoke(messages: BaseMessage[]): Promise<{ raw: BaseMessage; parsed: unknown }>;
}

/**
 * The model as a *parameter*, same as in `describe.ts` and for the same reason:
 * the test suite hands this function a stub and runs with no API key, no
 * network, and no spend. Only the two methods actually used are declared.
 */
export interface StructuringModel {
  /** Model id, needed to price the call. ChatAnthropic exposes this. */
  model?: string;
  withStructuredOutput(
    schema: z.ZodType,
    config: { name: string; includeRaw: true },
  ): StructuredOutputRunnable;
}

export interface ExtractionResult<T> {
  /** The validated document, or undefined if validation failed. */
  data: T | undefined;
  /** Why validation failed, in a form worth showing a human or the model. */
  validationError: string | undefined;
  /** Token counts as reported by the API. */
  usage: UsageMetadata | undefined;
  /** Dollars, or undefined when the model is not in our price table. */
  cost: Cost | undefined;
}

/**
 * The instruction that accompanies the image.
 *
 * Deliberately thin. Almost everything a prompt would normally say — what each
 * field means, when to return null, how to format a date — is already in the
 * schema, where the model reads it as part of the tool definition. Repeating it
 * here would mean maintaining the same rule in two places that can disagree.
 *
 * Milestone 4 is where this grows a system prompt and a few-shot example, and
 * where the eval harness can say whether any of that helped.
 */
function extractionInstruction(label: string): string {
  return `This is a scanned ${label}. Read it and record its fields using the provided tool.

Work only from what is on the page. Where a field is not present, return null rather than a plausible value — an invented invoice number is far worse than a missing one, because nothing downstream can tell the difference.`;
}

function firstToolCallArguments(raw: BaseMessage): unknown {
  if (!isAIMessage(raw)) return undefined;
  return raw.tool_calls?.[0]?.args;
}

/** Zod issues as a readable list. Same shape as the env errors, for consistency. */
function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(whole document)"}: ${issue.message}`)
    .join("\n");
}

export async function extractDocument<TSchema extends z.ZodType>(
  model: StructuringModel,
  image: LoadedImage,
  documentType: DocumentType<TSchema>,
): Promise<ExtractionResult<z.infer<TSchema>>> {
  const structured = model.withStructuredOutput(documentType.schema, {
    // The tool's name, which the model reads as an instruction — see the note
    // on `toolName` in src/schemas/registry.ts.
    name: documentType.toolName,
    includeRaw: true,
  });

  const message = new HumanMessage({
    content: [
      // Image first, then the instruction: the model reads content blocks in
      // order, so it has looked at the page before it reads the question.
      { type: "image", mimeType: image.mimeType, data: image.base64 },
      { type: "text", text: extractionInstruction(documentType.label) },
    ],
  });

  const { raw, parsed } = await structured.invoke([message]);

  const usage = isAIMessage(raw) ? raw.usage_metadata : undefined;
  const modelId = model.model;
  const cost = usage && modelId ? estimateCost(usage, modelId) : undefined;

  // `parsed` is null when LangChain's own validation failed; fall back to the
  // unvalidated tool arguments so the error below can name what was wrong.
  const candidate = parsed ?? firstToolCallArguments(raw);
  const result = documentType.schema.safeParse(candidate);

  if (!result.success) {
    return {
      data: undefined,
      validationError:
        candidate === undefined
          ? "The model returned no tool call at all, so there is nothing to validate."
          : formatValidationError(result.error),
      usage,
      cost,
    };
  }

  return { data: result.data, validationError: undefined, usage, cost };
}
