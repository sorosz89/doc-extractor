import type { UsageMetadata } from "@langchain/core/messages";

/**
 * Token accounting.
 *
 * Every LLM call bills input tokens and output tokens at different rates, and
 * output is typically 5x input. For document extraction the input side
 * dominates anyway, because an image is worth a *lot* of tokens: roughly
 * (width x height) / 750. A 1536x2048 scan is therefore ~4200 tokens before
 * you have written a single word of prompt — which is why milestone 5 resizes
 * images, and why we print the real counts on every run rather than guessing.
 */

/** USD per million tokens. Source: https://claude.com/pricing#api */
export const PRICES = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
} as const satisfies Record<string, { input: number; output: number }>;

export type KnownModel = keyof typeof PRICES;

export function isKnownModel(model: string): model is KnownModel {
  return model in PRICES;
}

export interface Cost {
  /** USD attributable to input (prompt + image) tokens. */
  inputUsd: number;
  /** USD attributable to generated tokens. */
  outputUsd: number;
  /** USD for the call. */
  totalUsd: number;
}

const PER_MILLION = 1_000_000;

/**
 * Convert a LangChain `usage_metadata` record into dollars.
 *
 * Pure function, so it is cheap to unit-test and impossible to get wrong by
 * accident. Returns `undefined` for an unpriced model rather than silently
 * reporting $0 — a wrong number is worse than a missing one.
 */
export function estimateCost(usage: UsageMetadata, model: string): Cost | undefined {
  if (!isKnownModel(model)) return undefined;

  const price = PRICES[model];
  const inputUsd = (usage.input_tokens / PER_MILLION) * price.input;
  const outputUsd = (usage.output_tokens / PER_MILLION) * price.output;

  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}

/** Format dollars at a precision where a single-page extraction is still visible. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(5)}`;
}
