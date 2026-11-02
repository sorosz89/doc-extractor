# doc-extractor

A TypeScript + LangChain.js pipeline that turns scanned documents (images, and
later multi-page PDFs) into validated, structured JSON using Claude's vision
capabilities.

This is a **study project**: every stage is built to teach one AI concept, not
just to work. See [`CLAUDE.md`](CLAUDE.md) for the full design and the
nine-milestone roadmap, and [`docs/learning-log.md`](docs/learning-log.md) for
what each milestone actually taught.

## Status

**Milestone 1 of 9 — hello vision.** Send one page image to Claude, get a
free-text description plus real token counts and cost.

## Setup

```bash
npm install
cp .env.example .env     # then add your Anthropic API key
```

## Usage

```bash
# Put a scan in eval/dataset/ first — see eval/dataset/README.md
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
├─ extract/     # the Claude calls and their prompts
├─ llm/         # model factory, env config, cost tracking
└─ cli.ts
eval/dataset/   # your scans + hand-written ground truth (milestone 4)
docs/           # learning log
```

Folders arrive with the milestone that needs them, so the tree stays honest
about what exists. `preprocess/`, `classify/`, `schemas/`, `validate/`, and
`output/` are coming — see `CLAUDE.md`.
