import { Command } from "commander";
import { loadImage, ImageLoadError } from "./ingest/loadImage.js";
import { createExtractionModel, EXTRACTION_MODEL } from "./llm/models.js";
import { loadDotEnv, EnvError } from "./llm/env.js";
import { describeDocument } from "./extract/describe.js";
import { formatUsd } from "./llm/cost.js";

const program = new Command();

program
  .name("doc-extractor")
  .description("Turn scanned documents into structured JSON with Claude vision")
  .version("0.1.0");

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

    // Printed on every run on purpose. Tokens and dollars are the two numbers
    // that decide whether an LLM pipeline is viable, and the fastest way to
    // build intuition for them is to see them next to every single result.
    if (result.usage) {
      const { input_tokens, output_tokens, total_tokens } = result.usage;
      console.log(`\n--- usage ---`);
      console.log(`input:  ${input_tokens.toLocaleString()} tokens (mostly the image)`);
      console.log(`output: ${output_tokens.toLocaleString()} tokens`);
      console.log(`total:  ${total_tokens.toLocaleString()} tokens`);
      if (result.cost) {
        console.log(`cost:   ${formatUsd(result.cost.totalUsd)} (in ${formatUsd(result.cost.inputUsd)} + out ${formatUsd(result.cost.outputUsd)})`);
      } else {
        console.log(`cost:   unknown — ${options.model} is not in the price table in src/llm/cost.ts`);
      }
    }
  });

// Later milestones: `extract <file>` (milestone 2) and `eval` (milestone 4).

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // An expected, actionable failure gets its message and nothing else. A
    // stack trace for "you forgot your API key" teaches the reader nothing.
    if (error instanceof EnvError || error instanceof ImageLoadError) {
      console.error(`\n${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
