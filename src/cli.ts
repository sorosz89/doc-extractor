import { Command } from "commander";
import { loadImage, ImageLoadError } from "./ingest/loadImage.js";
import { createExtractionModel, EXTRACTION_MODEL } from "./llm/models.js";
import { loadDotEnv, EnvError } from "./llm/env.js";
import { describeDocument } from "./extract/describe.js";
import { extractDocument } from "./extract/extractDocument.js";
import {
  DOCUMENT_TYPE_KEYS,
  getDocumentType,
  UnknownDocumentTypeError,
} from "./schemas/registry.js";
import { formatUsd, type Cost } from "./llm/cost.js";
import type { UsageMetadata } from "@langchain/core/messages";

const program = new Command();

program
  .name("doc-extractor")
  .description("Turn scanned documents into structured JSON with Claude vision")
  .version("0.1.0");

/**
 * Printed on every run on purpose. Tokens and dollars are the two numbers that
 * decide whether an LLM pipeline is viable, and the fastest way to build
 * intuition for them is to see them next to every single result — including the
 * failed ones, which cost exactly as much as the successful ones.
 */
function printUsage(usage: UsageMetadata | undefined, cost: Cost | undefined, model: string): void {
  if (!usage) return;

  const { input_tokens, output_tokens, total_tokens } = usage;
  console.log(`\n--- usage ---`);
  console.log(`input:  ${input_tokens.toLocaleString()} tokens (mostly the image)`);
  console.log(`output: ${output_tokens.toLocaleString()} tokens`);
  console.log(`total:  ${total_tokens.toLocaleString()} tokens`);
  if (cost) {
    console.log(`cost:   ${formatUsd(cost.totalUsd)} (in ${formatUsd(cost.inputUsd)} + out ${formatUsd(cost.outputUsd)})`);
  } else {
    console.log(`cost:   unknown — ${model} is not in the price table in src/llm/cost.ts`);
  }
}

program
  .command("describe")
  .description("Milestone 1: send one page image to Claude and print what it sees")
  .argument("<file>", "path to a scanned page (png, jpg, gif, webp)")
  .option("-m, --model <id>", "model id to use", EXTRACTION_MODEL)
  .action(async (file: string, options: { model: string }) => {
    loadDotEnv();

    const image = await loadImage(file);
    const model = createExtractionModel({ model: options.model });

    console.log(`Reading ${image.filename} (${(image.bytes / 1024).toFixed(0)} KB, ${image.mimeType}) with ${options.model}...\n`);

    const result = await describeDocument(model, image);

    console.log(result.text);
    printUsage(result.usage, result.cost, options.model);
  });

program
  .command("extract")
  .description("Milestone 2: read a page image into validated, typed JSON")
  .argument("<file>", "path to a scanned page (png, jpg, gif, webp)")
  // Required rather than defaulted. With no classifier yet, a default would
  // quietly read a prose page with the table schema and return a confident,
  // empty result. Milestone 6 replaces this flag with a classifier that has to
  // make the same choice — and has to be allowed to answer "neither".
  .requiredOption("-t, --type <type>", `document type: ${DOCUMENT_TYPE_KEYS.join(", ")}`)
  .option("-m, --model <id>", "model id to use", EXTRACTION_MODEL)
  .action(async (file: string, options: { type: string; model: string }) => {
    loadDotEnv();

    // Resolved before the file is read and before any model is built: a typo in
    // `--type` should cost nothing.
    const documentType = getDocumentType(options.type);
    const image = await loadImage(file);
    const model = createExtractionModel({ model: options.model });

    console.log(`Extracting ${documentType.label} fields from ${image.filename} (${(image.bytes / 1024).toFixed(0)} KB) with ${options.model}...\n`);

    const result = await extractDocument(model, image, documentType);

    if (result.data) {
      console.log(JSON.stringify(result.data, null, 2));
    } else {
      // Not a crash: the call succeeded and the model answered, the answer just
      // did not satisfy the schema. Milestone 7 turns this into a retry that
      // hands the message below back to the model; for now it is a report.
      console.error(`The model's answer did not match the ${documentType.label} schema:\n`);
      console.error(result.validationError);
      process.exitCode = 1;
    }

    printUsage(result.usage, result.cost, options.model);
  });

// Later milestones: `eval` (milestone 3).

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // An expected, actionable failure gets its message and nothing else. A
    // stack trace for "you forgot your API key" teaches the reader nothing.
    if (
      error instanceof EnvError ||
      error instanceof ImageLoadError ||
      error instanceof UnknownDocumentTypeError
    ) {
      console.error(`\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
