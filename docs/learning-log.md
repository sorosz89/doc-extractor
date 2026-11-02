# Learning log

One entry per milestone: what was built, and the AI concept it was there to teach.

---

## Milestone 1 — Hello vision

**Built:** project scaffold (strict TypeScript, Vitest, env handling, CLI) and a
single command, `describe <file>`, that sends one page image to Claude and
prints a free-text description plus real token counts and cost.

### 1. A multimodal message is a list of blocks, not a string

The whole concept fits in one object (`src/extract/describe.ts`):

```ts
new HumanMessage({
  content: [
    { type: "image", mimeType: "image/png", data: base64 },
    { type: "text", text: "Describe this scanned document..." },
  ],
});
```

A text-only chat message has a string `content`. A multimodal one has an
**ordered array of typed blocks**, and an image is just another block sitting
beside the text. The order is meaningful: the model processes blocks in
sequence, so image-then-question means it has looked at the page before it reads
what is being asked about the page.

LangChain v1 calls this shape a *standard content block* — `mimeType` and a flat
`data` field — and translates it into each provider's native format on the wire
(for Anthropic: `{ type: "image", source: { type: "base64", media_type, data } }`).
Worth knowing because v0.3 used different field names (`source_type`,
`mime_type`) and a lot of published examples, including some current docs pages,
still show the old shape. The authoritative answer was in the installed
`@langchain/core` type definitions, not in any blog post.

### 2. This is not OCR, and the difference is the point

A classical pipeline runs OCR first, producing a text blob, then reasons over
that blob. Everything non-textual — where the total sits relative to the line
items, which column a number belongs to, whether a signature is present, whether
a field is handwritten — is discarded at that first step and cannot be
recovered.

A vision-language model has no such step. The page becomes tokens directly, so
layout, table structure, and handwriting are all still present when the model
answers. That is why the pipeline in `CLAUDE.md` has no OCR stage: it would be a
lossy preprocessing step in front of a model that reads better without it.

The cost is a different failure mode. OCR fails *visibly* — you get garbled
characters. A VLM fails *plausibly*: it will produce a well-formed, confident,
wrong invoice number. Milestones 2, 3, and 7 (schemas, null-instead-of-guess
prompting, validation) exist entirely to manage that.

### 3. Images cost tokens, and the image dominates the bill

An image costs roughly `(width x height) / 750` input tokens. A 1536x2048 scan
is about 4,200 tokens — before a single word of prompt. The answer is a few
hundred output tokens. So on a document pipeline, **input is the bill**, which
inverts the usual chat intuition where output pricing (5x input) is what hurts.

Two consequences that shape later milestones:

- Resizing is a cost lever with a direct accuracy tradeoff (milestone 5). Too
  small and the model cannot read the small print; too large and you pay for
  resolution the model gains nothing from.
- Routing matters (milestone 6). The same page sent to Haiku instead of Sonnet
  costs half as much on input. Classification does not need Sonnet; extraction
  does.

This is why `src/cli.ts` prints tokens and cost on *every* run. Seeing the real
number next to every result builds intuition that no formula does.

### 4. API keys: validate at the edge, never log the value

`src/llm/env.ts` parses `process.env` through a Zod schema once, at startup, and
everything downstream receives a typed object. Two rules:

- Fail fast with a readable message. "ANTHROPIC_API_KEY is not set" beats a 401
  from the API and beats a stack trace.
- Never put the secret in an error, a log, or a trace. There is a test
  (`env.test.ts`) asserting exactly that, because this is the kind of thing that
  only gets noticed after a key ends up in a bug report.

Also: `dotenv` was not installed. Node has had `process.loadEnvFile()` built in
since 20.12, so the dependency most tutorials still reach for is dead weight.

### 5. The finding worth remembering: `temperature: 0` is dated advice

`CLAUDE.md`'s roadmap lists "why extraction uses temperature 0" as a concept to
learn. Checking it against the current API turned up something better than the
concept itself.

**Sonnet 5 and Opus 5 removed the sampling parameters.** Sending `temperature`,
`top_p`, or `top_k` returns HTTP 400. The advice to pin temperature to 0 for
extraction — near-universal in LLM tutorials, and correct for years — cannot
even be expressed on the current generation of models.

What replaced it is `outputConfig: { effort: "low" | "medium" | "high" | "xhigh" | "max" }`,
which controls how many tokens the model spends reasoning before it answers.
That is a quality/cost dial, not a randomness dial, so the mental model changes:
consistency now comes from a constraining schema (milestone 2), an explicit
prompt (milestone 3), and validation (milestone 7) — not from a sampling knob.

`src/llm/models.ts` makes the contrast concrete on purpose. The Haiku 4.5
classifier *does* set `temperature: 0`, because that previous-generation model
still accepts it — and it must *not* set `effort`, which it predates and
rejects. The same two parameters, legal on one model and a 400 on the other.

The generalisable lesson is not about temperature. It is that LLM API surfaces
drift fast enough that confident advice — including advice written into this
project's own plan a few months ago — needs checking against the model's current
contract before it is built on.

### Verification notes

- `npm test` runs with **no API key and no network**: 24 tests, nothing billed.
  That works because `describeDocument()` takes the model as a *parameter*
  rather than constructing one, so a test can hand it a stub. A function that
  builds its own client can only be tested by paying for it — a small design
  choice with a large effect on how often you are willing to run the suite.
- `npm run typecheck` is clean under `strict` plus `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes`.
