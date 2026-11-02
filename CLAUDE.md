# Scanned Documents → Structured Data: TypeScript + LangChain + Claude

Nov 2, 2026 · @Sándor Orosz

## Summary and goals

We build a TypeScript pipeline that takes scanned documents (images or PDFs) and returns validated, structured JSON, using Claude's vision capabilities orchestrated through LangChain.js. The project is primarily a learning vehicle: every stage should teach one AI concept, not just work.

**Input:** scanned documents (PNG, JPG, multi-page PDF), e.g. invoices, receipts, forms.

**Output:** typed JSON matching a predefined schema per document type, plus metadata (confidence, warnings, source page).

**Learning goals:**

- Understand how multimodal LLMs read images and why that differs from OCR.
- Learn structured output: tool calling, JSON schemas, and validation.
- Practise prompt engineering for extraction (instructions, examples, edge cases).
- Build an evaluation harness that measures accuracy, not just "it looks right".
- Understand the cost, latency, and reliability trade-offs of LLM pipelines.

**Non-goals for v1:** a UI, cloud deployment, training or fine-tuning models.

## Approach

We send each page image directly to Claude together with a target schema, and Claude returns the fields as structured output in one step. There is no separate OCR stage: the vision-language model reads layout, tables, and handwriting itself.

The key ideas:

- **Schema first.** Each document type (invoice, receipt, form) has a Zod schema. The schema drives the prompt, the structured output, and validation.
- **Effort, not temperature.** Current models reject `temperature`, so consistency comes from the schema, the prompt, and validation; `outputConfig.effort` is the quality/cost dial.
- **Structured output via tool calling.** LangChain's `withStructuredOutput()` turns the Zod schema into a tool definition that Claude must fill, which is far more reliable than asking for JSON in plain text.
- **Classify, then extract.** A cheap first call identifies the document type; a second call extracts with the matching schema.
- **Validate and repair.** Zod plus business rules (totals add up, dates are valid) catch errors; failures trigger one retry with the error message fed back to the model.
- **Human in the loop.** Low-confidence or invalid results are flagged for review instead of silently accepted.

## Pipeline architecture

Five stages turn a scan into validated JSON; anything that fails validation twice goes to a person instead of being guessed.

&#91;embedded content: extraction pipeline · 5 stages, 2 outcomes\]

Each stage is a LangChain runnable, so the whole pipeline composes into one chain you can trace and test stage by stage.

## Tech stack

Node.js with TypeScript, LangChain.js for orchestration, and Claude as the vision model. Exact package versions are chosen in the code session.

| Area | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js LTS + TypeScript (strict) | Type safety end to end, from schema to output |
| LLM orchestration | `langchain`, `@langchain/core`, `@langchain/anthropic` | Chains, structured output, retries, tracing |
| Model | `claude-sonnet-5` for extraction, `claude-haiku-4-5` for classification | Strong vision and tool calling; cheaper model where accuracy matters less. Undated aliases only, never date-pinned snapshots |
| Schemas | Zod | One definition for types, prompts, and validation |
| PDF to images | `pdf-to-img` or `pdfjs-dist` | Claude reads page images; PDFs are split into pages |
| Image preprocessing | `sharp` | Resize, rotate, grayscale, compress before sending |
| Observability | LangSmith (optional) | Inspect every prompt, response, token count, and cost |
| Testing | Vitest | Unit tests and the evaluation harness |
| CLI | `commander` | Simple `extract <file>` and `eval` commands |

## AI concepts to learn

Each concept maps to a part of the pipeline, so you learn it by building it.

| Concept | What to understand | Where it appears |
| --- | --- | --- |
| Multimodal input | How images become tokens; why resolution affects cost and accuracy | Preprocessing, model call |
| Tokens and context window | Pricing per input/output token; image token cost; page limits | Cost tracking, batching pages |
| Prompt engineering | System prompts, clear instructions, field descriptions, few-shot examples | Extraction prompts |
| Structured output / tool calling | How a schema becomes a tool the model must fill | `withStructuredOutput()` |
| Hallucination | Why models invent plausible values; how to make them return null instead | Schema design, prompts |
| Validation and self-correction | Feeding errors back so the model repairs its own output | Retry loop |
| Model routing | Using cheaper models for easy steps | Classifier vs extractor |
| Effort, not temperature | Why the old "temperature 0 for extraction" rule no longer applies, and what replaced it | Model config (`src/llm/models.ts`) |
| Evaluation | Ground truth, field-level accuracy, regression testing of prompts | Eval harness |
| Observability | Tracing chains to debug prompts and costs | LangSmith |
| Prompt caching and batching (later) | Reducing cost for repeated system prompts and large volumes | Optimisation milestone |

## Proposed project structure

One folder per pipeline stage, so each stage can be studied and tested on its own.

```
doc-extractor/
├─ src/
│  ├─ ingest/        # load files, PDF → page images
│  ├─ preprocess/    # resize, rotate, compress (sharp)
│  ├─ classify/      # document-type classifier chain
│  ├─ schemas/       # Zod schemas per document type
│  ├─ extract/       # extraction chains + prompts
│  ├─ validate/      # Zod + business rules + repair loop
│  ├─ output/        # JSON writer, review queue
│  ├─ llm/           # model factory, config, cost tracking
│  └─ cli.ts         # extract / eval commands
├─ eval/
│  ├─ dataset/       # sample scans + ground-truth JSON
│  └─ run-eval.ts    # field-level accuracy report
├─ docs/
│  └─ learning-log.md  # what you learned at each milestone
├─ CLAUDE.md         # project context for Claude Code
└─ .env.example      # ANTHROPIC_API_KEY, LANGSMITH_API_KEY
```

## Milestones and learning roadmap

Build in small steps; each milestone ends with working code and a short entry in `learning-log.md`.

1. **Hello vision.** Send one scanned image to Claude via `@langchain/anthropic` and print a free-text description. *Learn:* multimodal messages, API keys, token usage.
2. **First structured extraction.** Define an invoice Zod schema and use `withStructuredOutput()`. *Learn:* tool calling, schema design, field descriptions.
3. **Prompt engineering.** Add a system prompt, null-instead-of-guess rules, and one few-shot example; compare results. *Learn:* how wording changes output.
4. **Evaluation harness.** Create 10–20 labelled samples and measure field-level accuracy. *Learn:* why you need numbers before changing prompts.
5. **Multi-page PDFs and preprocessing.** Convert PDFs to images, resize, and merge page results. *Learn:* image token cost vs accuracy.
6. **Classification and routing.** Add a Haiku-tier classifier that picks the schema. *Learn:* model routing, chaining with LCEL.
7. **Validation and repair loop.** Business rules plus a retry that feeds errors back. *Learn:* self-correction, failure modes.
8. **Observability and cost.** Enable LangSmith tracing; log cost per document. *Learn:* debugging chains in production.
9. **Optimisation (optional).** Prompt caching, the Batch API, concurrency limits. *Learn:* scaling an LLM pipeline.

## Evaluation approach

Every prompt or model change is judged against a fixed labelled dataset, never by eyeballing a single document.

- **Dataset:** 10–20 scans per document type, each with a hand-written ground-truth JSON. Include hard cases: skewed scans, low resolution, handwriting, multi-page.
- **Field-level accuracy:** exact match for IDs and dates, normalised match for text, tolerance for amounts.
- **Document-level pass rate:** share of documents where all required fields are correct.
- **Null correctness:** does the model return null for missing fields instead of inventing them?
- **Cost and latency:** tokens and seconds per document, tracked over time.
- **Report:** `npm run eval` prints a table per field so you can see which prompt change helped or hurt.

Sample data sources to explore: your own scanned receipts, or public datasets such as SROIE (receipts) and FUNSD (forms).

## Working with Claude Code

Since this is a study project, use Claude Code as a tutor and pair programmer, not as an autopilot.

- **Start with `CLAUDE.md`.** Paste the summary, stack, and structure from this doc into it so every session has the context.
- **One milestone per session.** Ask for a plan first, review it, then let it implement.
- **Ask "why".** After each step, ask Claude Code to explain the AI concept behind the code and add notes to `learning-log.md`.
- **Write some parts yourself.** Especially prompts and schemas; let Claude Code review them.
- **Keep the eval green.** Ask it to run `npm run eval` after every prompt change and compare results.

Suggested kickoff prompt:

```
I'm building a study project: a TypeScript + LangChain.js pipeline that turns
scanned documents into structured JSON using Claude's vision capabilities.
Read CLAUDE.md for the goals, stack, and structure. Let's start with
milestone 1: scaffold the project (strict TypeScript, Vitest, .env handling)
and send one sample image to Claude via @langchain/anthropic.
Plan first, then implement. Explain each AI-related concept as we go.
```
