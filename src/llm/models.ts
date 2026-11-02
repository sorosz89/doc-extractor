import { ChatAnthropic } from "@langchain/anthropic";
import { readEnv } from "./env.js";
import type { KnownModel } from "./cost.js";

/**
 * The model factory: one place where every model decision lives.
 *
 * Why a factory rather than `new ChatAnthropic(...)` at each call site?
 * Milestone 6 (model routing) and milestone 3 (prompt comparison) both depend
 * on being able to change the model in exactly one place. If an extraction
 * prompt experiment also drifts the model, the experiment means nothing.
 */

/** Extraction and vision work. Sonnet tier: strong vision, mid price. */
export const EXTRACTION_MODEL = "claude-sonnet-5" satisfies KnownModel;

/** Document-type classification (milestone 6). Haiku tier: the cheap step. */
export const CLASSIFIER_MODEL = "claude-haiku-4-5" satisfies KnownModel;

/**
 * `maxTokens` is a *ceiling*, not a target — you are billed for what the model
 * actually generates, not for what you allowed. Setting it low does not save
 * money; it truncates the answer mid-sentence and forces a retry, which costs
 * more. Keep it generous.
 */
const MAX_TOKENS = 16_000;

export interface ModelOptions {
  /** Override the model id, e.g. from a CLI flag. */
  model?: string;
  /** Pass an explicit key instead of reading the environment (tests, scripts). */
  apiKey?: string;
}

function resolveApiKey(options: ModelOptions): string {
  return options.apiKey ?? readEnv().ANTHROPIC_API_KEY;
}

/**
 * Model for reading documents.
 *
 * Note what is *absent*: `temperature: 0`.
 *
 * Received wisdom says extraction should pin temperature to 0 for
 * determinism. That advice predates the current model generation: Sonnet 5 and
 * Opus 5 removed the sampling parameters entirely and return HTTP 400 if you
 * send `temperature`, `top_p`, or `top_k`. Consistency now comes from the
 * schema (milestone 2), the prompt (milestone 3), and `effort` below — not from
 * a sampling knob. See docs/learning-log.md.
 */
export function createExtractionModel(options: ModelOptions = {}): ChatAnthropic {
  return new ChatAnthropic({
    model: options.model ?? EXTRACTION_MODEL,
    apiKey: resolveApiKey(options),
    maxTokens: MAX_TOKENS,
    // `effort` replaced the old fixed "thinking budget": it controls how many
    // tokens Claude spends reasoning before answering. "medium" is a starting
    // guess — milestone 4's eval harness is what tells us whether "high" earns
    // its extra cost on real scans. Guessing is what the harness exists to end.
    outputConfig: { effort: "medium" },
  });
}

/**
 * Model for the document-type classifier (milestone 6).
 *
 * Two deliberate differences from the extractor, both worth noticing:
 *  - A cheaper model, because picking one label off a page is far easier than
 *    reading every field off it. That is model routing in one line.
 *  - `temperature: 0` *is* valid here. Haiku 4.5 is a previous-generation
 *    model and still accepts sampling parameters. The same parameter being
 *    legal on one model and a 400 on another is the clearest possible reminder
 *    to check the model's own contract rather than trust a blog post.
 *  - No `outputConfig.effort`: Haiku 4.5 predates it and rejects it.
 */
export function createClassifierModel(options: ModelOptions = {}): ChatAnthropic {
  return new ChatAnthropic({
    model: options.model ?? CLASSIFIER_MODEL,
    apiKey: resolveApiKey(options),
    maxTokens: 1_024,
    temperature: 0,
  });
}
