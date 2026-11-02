import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command, Option } from "commander";
import { loadDotEnv, EnvError } from "../src/llm/env.js";
import {
  createExtractionModel,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  EXTRACTION_MODEL,
  type Effort,
} from "../src/llm/models.js";
import { ImageLoadError } from "../src/ingest/loadImage.js";
import { DatasetError, loadDataset } from "./src/dataset.js";
import { formatReport, summarise, type Summary } from "./src/report.js";
import { runSample, type SampleRun } from "./src/runner.js";

/**
 * `npm run eval` — run every labelled sample through the real pipeline and
 * score it against ground truth.
 *
 * This is the one command in the project whose job is to cost money on
 * purpose, so it says what it is about to do before doing it, runs samples one
 * at a time (clean latency numbers, no rate-limit surprises), and saves every
 * run so the next one can be compared against it with `--baseline`.
 */

interface Options {
  dataset: string;
  type?: string;
  sample?: string;
  repeat: string;
  model: string;
  effort: Effort;
  baseline?: string;
  dryRun?: boolean;
}

interface ResultsFile {
  startedAt: string;
  model: string;
  effort: Effort;
  runs: SampleRun[];
  summary: Summary;
}

const RESULTS_DIR = "eval/results";

const program = new Command()
  .name("eval")
  .description("Score extraction against hand-written ground truth")
  .option("-d, --dataset <dir>", "folder of scans and *.truth.json files", "eval/dataset")
  .option("-t, --type <type>", "only samples of this document type")
  .option("-s, --sample <name>", "only samples whose name contains this text")
  .option("-r, --repeat <n>", "run each sample n times, to see run-to-run variance", "1")
  .option("-m, --model <id>", "extraction model", EXTRACTION_MODEL)
  .addOption(new Option("-e, --effort <level>", "extraction effort").choices(EFFORT_LEVELS).default(DEFAULT_EFFORT))
  .option("-b, --baseline <file>", "earlier results file to compare against")
  .option("--dry-run", "list the samples that would run, and stop")
  .action(async (options: Options) => {
    const repeat = Number.parseInt(options.repeat, 10);
    if (!Number.isInteger(repeat) || repeat < 1) throw new DatasetError(`--repeat must be a positive integer`);

    const samples = (await loadDataset(options.dataset)).filter(
      (s) => (!options.type || s.type === options.type) && (!options.sample || s.name.includes(options.sample)),
    );

    if (samples.length === 0) {
      console.log(`No samples match in ${options.dataset}. A sample is a <name>.truth.json — see eval/dataset/README.md.`);
      return;
    }

    console.log(
      `${samples.length} sample(s) × ${repeat} = ${samples.length * repeat} call(s) to ${options.model} at effort ${options.effort}:`,
    );
    for (const s of samples) console.log(`  ${s.name} [${s.type}]`);
    if (options.dryRun) return;

    const baseline = options.baseline
      ? (JSON.parse(await readFile(options.baseline, "utf8")) as ResultsFile).summary
      : undefined;

    loadDotEnv();
    const model = createExtractionModel({ model: options.model, effort: options.effort });

    const startedAt = new Date().toISOString();
    const runs: SampleRun[] = [];
    for (const sample of samples) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        process.stdout.write(`  running ${sample.name}${repeat > 1 ? ` #${attempt}` : ""}... `);
        const run = await runSample(model, sample, attempt);
        console.log(`${run.pass ? "pass" : "FAIL"} (${(run.latencyMs / 1000).toFixed(1)}s)`);
        runs.push(run);
      }
    }

    const summary = summarise(runs);
    console.log(formatReport(runs, summary, baseline));

    await mkdir(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, "-")}-${options.model}-${options.effort}.json`);
    const results: ResultsFile = { startedAt, model: options.model, effort: options.effort, runs, summary };
    await writeFile(file, JSON.stringify(results, null, 2));
    console.log(`\nSaved ${file}. Compare a later run with --baseline ${file}`);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof DatasetError || error instanceof EnvError || error instanceof ImageLoadError) {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
