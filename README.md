# doc-extractor

A TypeScript + LangChain.js pipeline that turns scanned documents (images, and
later multi-page PDFs) into validated, structured JSON using Claude's vision
capabilities.

This is a **study project**: every stage is built to teach one AI concept, not
just to work. See [`CLAUDE.md`](CLAUDE.md) for the full design and the
nine-milestone roadmap, and [`docs/learning-log.md`](docs/learning-log.md) for
what each milestone actually taught.

## Status

**Milestone 2 of 9 done — first structured extraction.** A page image goes in,
validated typed JSON comes out, via a Zod schema Claude is forced to fill as a
tool call. Two document types: `table` (any page built around tables — nutrient
tables, composition tables, price lists) and `prose` (faithful transcription
plus the metadata printed on the page). Tokens and cost print on every run.

**Next: milestone 3, the eval harness.** A real table extraction passed every
check with several cells wrong, so field-level accuracy against hand-written
ground truth comes before any prompt tuning. See `docs/learning-log.md` §8.

## Setup

```bash
npm install
cp .env.example .env     # then add your Anthropic API key
```

## Usage

```bash
# Put a scan in eval/dataset/ first — see eval/dataset/README.md

# Milestone 2: read a page into validated JSON (--type is required)
npm run extract -- eval/dataset/your-table.jpg --type table
npm run extract -- eval/dataset/your-letter.png --type prose

# Milestone 1: free-text description of a page
npm run describe -- eval/dataset/your-scan.png

# Try a different model
npm run describe -- eval/dataset/your-scan.png --model claude-haiku-4-5
```

```bash
npm test          # offline: no API key, no network, no spend
npm run typecheck
```

## Layout

```
src/
├─ ingest/      # load files, PDF → page images (milestone 5)
├─ schemas/     # Zod schema per document type + the type registry
├─ extract/     # the Claude calls and their prompts
├─ llm/         # model factory, env config, cost tracking
└─ cli.ts
eval/dataset/   # your scans + hand-written ground truth (milestone 3)
docs/           # learning log
```

Folders arrive with the milestone that needs them, so the tree stays honest
about what exists. `preprocess/`, `classify/`, `validate/`, and `output/` are
coming — see `CLAUDE.md`.

Adding a document type is two steps: write the schema in `src/schemas/`, add a
line to `src/schemas/registry.ts`. The recipe is in `docs/learning-log.md` §11,
and `src/schemas/invoice.ts` is a fully commented worked example — present as
reference, deliberately not registered.
