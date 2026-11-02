# Doc Extractor: Building a Vision Extraction Pipeline — Course

What building this project has taught so far, organised by concept rather than
by date. Covers milestones 1–2. The chronological record is
[`learning-log.md`](learning-log.md); the shareable copy of this course is the
[Claude Doc](https://claude.ai/artifact/Mqh6nqC3dHGgmob5zDmKH4).

Every lesson has the same five parts:

- **Key idea** — one sentence to remember.
- **Why it matters** — the reasoning, kept short.
- **In the code** — where the idea lives in the repo.
- **Evidence** — what a real run showed.
- **Check yourself** — a scenario question; answers are in the [Answer key](#answer-key).

## Cheat sheet

| # | Lesson | Key idea |
| --- | --- | --- |
| 1.1 | Vision, not OCR | A vision model reads layout directly; it fails plausibly, not visibly. |
| 1.2 | Where the bill goes | An image costs about width × height / 750 tokens; a dense table can flip the bill to output. |
| 2.1 | Structured output is tool calling | The schema becomes a tool the model must call, so the reply cannot be prose-wrapped JSON. |
| 2.2 | The schema is a prompt | Only what survives Zod → JSON Schema reaches the model; `.refine()` is invisible to it. |
| 2.3 | Nullable, not optional | A required key that may be null makes absence a countable claim. |
| 2.4 | `strict` vs nullability | Every nullable field is a union; the API allows 16, so `strict: true` is out. |
| 2.5 | Type by structure | Capture what a table is, keep cells as text, interpret later in plain code. |
| 2.6 | Prose encodes a question | Transcription is the only prose schema you can score against the page. |
| 2.7 | Designing a new schema | One field per thing on the page, all nullable, all described, tested as a prompt. |
| 3.1 | Validation is not accuracy | A table passed every check with several cells wrong. |
| 3.2 | Confidence in words | Self-reported probabilities are not calibrated; three buckets are enough to route. |
| 3.3 | Keep the failure message | `includeRaw` turns validation errors into a silent null; re-parse to keep the reason. |
| 4.1 | Effort, not temperature | Current models reject `temperature`; `effort` trades quality for cost. |
| 4.2 | Routing and abstention | A cheap classifier must be able to say "none of these". |
| 5.1 | Model as a parameter | Pass the model in, and the whole suite runs free and offline. |
| 5.2 | Secrets at the edge | Validate env once at startup; never log the value. |
| 5.3 | Runtime keys lose types | A type chosen at runtime is honestly `unknown` at compile time. |
| 5.4 | Check the contract | API advice rots fast; one cheap real call beats confident reasoning. |

---

## Module 1 — Seeing the page

A vision model reads the page itself, and the image is most of what you pay for.

### 1.1 Vision, not OCR

**Key idea.** A vision-language model turns the page straight into tokens, so
layout, table structure and handwriting survive until it answers.

**Why it matters.** A classic pipeline runs OCR first and reasons over a text
blob. Everything non-textual — which column a number sits in, what is
handwritten — is lost at that first step. The trade is in how each fails: OCR
fails *visibly* (garbled characters); a vision model fails *plausibly* (a clean,
confident, wrong number).

**In the code.** A multimodal message is an ordered list of typed blocks, image
first, then the question (`src/extract/describe.ts`):

```ts
new HumanMessage({
  content: [
    { type: "image", mimeType: "image/png", data: base64 },
    { type: "text", text: "Describe this scanned document..." },
  ],
});
```

This is LangChain v1's standard content block. Many examples online still show
the v0.3 shape (`source_type`, `mime_type`); the installed type definitions are
the authority.

**Evidence.** On a skewed photo of a 32-row nutrient table, each label sits
lower than its values. The model paired all 32 correctly — the step where
OCR-then-reason breaks.

**Check yourself.** Q1: A colleague proposes running Tesseract first and sending
Claude only the text, because text is cheaper. What do you lose, and what do you
gain?

### 1.2 Where the bill goes

**Key idea.** An image costs about width × height / 750 input tokens, so on a
document pipeline the image usually *is* the bill — except when the output is a
full table.

**Why it matters.** A 1536 × 2048 scan is about 4,200 tokens before any prompt.
Output is priced at 5× input, so a reply that writes every cell of a big table
can still outweigh the image.

| Run | Input tokens | Output tokens | Cost |
| --- | --- | --- | --- |
| Nutrient table, 32 × 12 | 5,250 | 1,879 | $0.029 |
| Prose letter | 3,747 | 432 | $0.012 |

On the table, output was about two-thirds of the cost; on the letter, input
dominated.

**In the code.** `src/cli.ts` prints tokens and cost on every run, because a
real number next to every result builds intuition no formula does.

**Evidence.** The table above, from real milestone 2 runs.

**Check yourself.** Q2: You must halve the cost of the table run. Which lever do
you pull first, and what accuracy risk does it carry?

---

## Module 2 — Asking for structure

The Zod schema is the prompt, the output contract and the validator at once, and
every design choice in it changes what the model does.

### 2.1 Structured output is tool calling

**Key idea.** `withStructuredOutput()` does not ask for JSON; it turns the
schema into a tool the model is forced to call.

**Why it matters.** "Reply in JSON" plus `JSON.parse()` mostly works and fails
on the documents you care about: markdown fences, "Here is the JSON", trailing
commas. A forced tool call makes that whole category impossible. The chain is:

1. Zod schema
2. JSON Schema
3. Anthropic tool definition + `tool_choice: { type: "tool", name }`

**In the code.** `src/extract/extractDocument.ts`. Gotcha: LangChain stops
forcing `tool_choice` if `thinking` is set on the client, so
`src/llm/models.ts` leaves it unset. The fallback is `method: "jsonSchema"`.

**Evidence.** No milestone 2 run returned unparseable output.

**Check yourself.** Q3: What actually travels over the API when you call
`withStructuredOutput(schema)`?

### 2.2 The schema is a prompt

**Key idea.** Only what survives the Zod → JSON Schema conversion reaches the
model; everything else is invisible to it.

**Why it matters.** A rule has two homes. One the model *reads* and can follow;
one checked *afterwards* that can reject an answer but never improve it.

| Zod | JSON Schema | Model sees it? |
| --- | --- | --- |
| `.describe("...")` | `description` | Yes |
| `.nullable()` | `type: ["string","null"]` | Yes, key stays required |
| `.optional()` | dropped from `required` | Yes |
| `.regex()`, `.min()`, `.length()` | `pattern`, `minLength`, `maxLength` | Yes |
| `.refine()` / `.superRefine()` | nothing | No |
| `.trim()` | nothing | No (still applies on parse) |

**In the code.** `src/schemas/dataTable.ts` states "one cell per column" in both
homes: in the `rows` description, which persuades, and in a `.superRefine()`,
which enforces. A ragged row shifts every later cell into the wrong column, so
it earns both.

**Evidence.** The 32 × 12 table came back with no ragged rows.

**Check yourself.** Q4: You add only a `.superRefine()` rejecting ragged rows.
Does the model now produce fewer of them?

### 2.3 Nullable, not optional

**Key idea.** `.nullable()` keeps the key required and allows `null`, so absence
becomes an explicit, countable claim.

**Why it matters.** With `.optional()` the model may leave the key out, so "I
looked and it is not there" and "I forgot" look identical. The eval can score
`null` against ground truth; it cannot score a missing key. The prompt's "return
null rather than guess" is the soft half of this rule; the schema is the half
that holds when the prompt is ignored. Same logic gives text fields
`minLength: 1`: an empty string is neither a value nor an admission of absence.

**In the code.** Field builders in `src/schemas/fields.ts`.

**Evidence.** A nutrient table read with a schema for a different document type
returned every field `null`, `confidence: "low"`, and a warning naming what the
page really was.

**Check yourself.** Q5: A table has no footnotes. `footnotes` is `.optional()`
and the key is missing. What can the eval conclude?

### 2.4 `strict: true` vs nullability

**Key idea.** Every nullable field is a union, the API caps strict tools at 16
unions, so on a real schema you choose between `strict` and nullability — and
nullability wins.

**Why it matters.** `strict` guarantees well-typed arguments, which Zod already
checks with a better error. `.nullable()` is what stops invention, and nothing
replaces it.

**In the code.** `strict` is not set anywhere.

**Evidence.** A real request returned: `400: ... 17 parameters with type arrays
or anyOf ... (limit: 16 parameters with unions)`. Limits like this appear only
in a real error, so budget one cheap experimental call.

**Check yourself.** Q6: Should the project turn on `strict: true`? What would
you have to give up?

### 2.5 Type by structure, not subject

**Key idea.** Capture what a table *is* — headings, columns, rows, footnotes —
and keep cells as text; interpret them later in plain code.

**Why it matters.** A `nutrients` schema needs a new version per layout,
silently drops unexpected columns, and makes the model decide invisibly that
"Retinol ekv. µg" means `vitaminA`. Cells like `12,5`, `< 0,1`, `n.a.`, `—` or
`1 200` parsed at extraction time let `—` quietly become `0`. Give the model the
job only it can do (reading); keep the job code does better (interpreting) out
of the prompt, where it stops being probabilistic and can be fixed without
paying for another extraction.

**In the code.** `src/schemas/dataTable.ts`.

**Evidence.** Decimal commas and `-` came back exactly as printed.

**Check yourself.** Q7: A cell reads `—`. Should cells be typed `number | null`
or text? Why?

### 2.6 Prose has no fields, so the schema encodes a question

**Key idea.** "Extract this prose" is meaningless until you choose the question;
only transcription can be scored against the page.

| Question | Schema | Scorable? |
| --- | --- | --- |
| What does the page say? | transcription + metadata | Yes, diff against the page |
| What is it about? | summary + entities | Only against a human reference |
| What are the answers to X? | targeted facts | Yes, if X is fixed up front |

**In the code.** `src/schemas/prose.ts` is the first row. The others would be
separate types, measured separately.

**Evidence.** A synthetic Hungarian letter: verbatim text, paragraph breaks
kept, `2026. marcius 14.` → `2026-03-14`, no invention.

**Check yourself.** Q8: A stakeholder asks to add a `summary` field to `prose`.
Why might it belong in a separate type?

### 2.7 Designing a schema for a new document type

**Key idea.** Start from a real page, one field per thing on it, and test the
schema as a prompt, not only as a validator.

1. Put a real document in front of you; list what a careful human would point
   at. Nothing derived.
2. One field, one thing on the page — merging gives the model room to be
   creative.
3. Reuse `src/schemas/fields.ts`; add a helper when a second type needs it.
4. Write descriptions that resolve ambiguity (which row is the header, what `—`
   means), not ones that restate the name.
5. Every scalar nullable, nothing optional.
6. Spread in `extractionMeta` for confidence and warnings.
7. Describe the object itself — it becomes the tool description.
8. Register it in `src/schemas/registry.ts`.
9. Test the generated JSON Schema: every field required and described.

**Check yourself.** Q9: Your field description says
`header: "the column header"`. What is wrong with it?

---

## Module 3 — Trusting the output

Passing validation proves the shape of an answer, never its truth — the single
most important lesson so far.

### 3.1 Validation is not accuracy

**Key idea.** An extraction can pass Zod, pass every business rule, report
`confidence: "high"`, and still be wrong.

**Why it matters.** This is the vision-model failure mode from 1.1 arriving as
predicted: well-formed, plausible, wrong. Checking by eye does not scale to a
384-cell table, so the eval harness moved ahead of prompt engineering in the
roadmap.

**In the code.** Nothing yet — that is the point. Milestone 3 builds the ground
truth that can tell.

**Evidence.** The skewed nutrient table: 32 × 12, no ragged rows, all labels
right. But in the sparse right-hand columns (Magnézium, Retinol, E-vitámin)
several cells appear to have drifted a row; `35,0` shows up as one row's
Magnézium *and* the next row's Kalcium. This was found by eye on a skewed photo,
so it is a reason to build the eval, not a measurement. It also makes a testable
hypothesis: deskewing (milestone 5) may fix the drift.

**Check yourself.** Q10: All checks are green and confidence is high. What,
precisely, have you learned about the extraction?

### 3.2 Confidence in words, not numbers

**Key idea.** Ask for `low | medium | high`, not 0.0–1.0; self-reported
probabilities are not calibrated.

**Why it matters.** A model asked for a score answers 0.95 to almost everything.
The number looks quantitative and measures nothing. Three buckets are a
judgement it can make and enough to route to a human. Real confidence comes from
measured accuracy.

**In the code.** `extractionMeta` in `src/schemas/fields.ts`.

**Evidence.** The drifted table above still said `high`.

**Check yourself.** Q11: Would a numeric confidence of 0.97 have caught the
drifted cells? Why not?

### 3.3 Keep the failure message

**Key idea.** With `includeRaw: true`, LangChain hides validation errors behind
`parsed: null`, so re-run `safeParse` yourself to keep the reason.

**Why it matters.** Without `includeRaw` you lose `usage_metadata`, and with it
the cost. With it, a failure becomes a bare `null`. "Returned nothing" and
"wrote the date as 01/10/2026" need different fixes, and the second message is
exactly what the repair loop (milestone 7) will feed back to the model.

**In the code.** `src/extract/extractDocument.ts` validates the tool call's
arguments with `safeParse`.

**Evidence.** Found by reading the installed LangChain source, not the docs.

**Check yourself.** Q12: Why not simply drop `includeRaw` and let validation
throw?

---

## Module 4 — Model configuration

Model settings are part of the API contract, and that contract differs between
model generations.

### 4.1 Effort, not temperature

**Key idea.** Sonnet 5 and Opus 5 reject `temperature`, `top_p` and `top_k`
with HTTP 400; `outputConfig.effort` replaced them, and it is a quality/cost
dial, not a randomness dial.

**Why it matters.** "Use temperature 0 for extraction" was correct for years and
cannot even be expressed on current models. Consistency now comes from a
constraining schema (Module 2), an explicit prompt (milestone 4) and validation
(milestone 7).

**In the code.** `src/llm/models.ts` shows both sides on purpose:

| Model | Role | `temperature` | `effort` |
| --- | --- | --- | --- |
| `claude-sonnet-5` | extraction | rejected (400) | set |
| `claude-haiku-4-5` | classification | `0` | rejected (predates it) |

**Evidence.** The same two parameters are legal on one model and a 400 on the
other.

**Check yourself.** Q13: Two runs on the same page give slightly different
cells. Name three things you would reach for, in order.

### 4.2 Routing and abstention

**Key idea.** A cheap model classifies, a strong model extracts — and the
classifier must be able to answer "none of these".

**Why it matters.**

- **Routing.** The same page on Haiku costs about half as much input as on
  Sonnet. Classification does not need Sonnet; extraction does.
- **Abstention.** Without "none", every document is forced into the nearest
  schema and the pipeline produces confident garbage. It is the
  null-instead-of-guess rule one level up.
- **Register only real types.** An unused type is a label the classifier can
  pick by mistake. That is why the invoice schema was removed.
- **Do not classify what you already know.** `--type` is free and cannot be
  wrong; it is required, not defaulted, because a default would silently read
  prose with the table schema.
- **Two calls beat one call with every schema as a tool.** One call is faster,
  but every tool definition sits in every prompt and the cheap model cannot do
  the easy half.

**In the code.** `src/schemas/registry.ts` is the seam the classifier will plug
into (milestone 6).

**Evidence.** The mismatched-schema run in 2.3 was only clean because the model
was allowed to say "this is not that document".

**Check yourself.** Q14: Someone proposes registering an `invoice` type "just in
case". Why is that harmful, not neutral?

---

## Module 5 — Engineering habits

Small design choices decide how often you are willing to test, and how safely.

### 5.1 The model is a parameter

**Key idea.** Functions take the model as an argument instead of constructing a
client, so tests pass in a stub.

**Why it matters.** A function that builds its own client can only be tested by
paying for it. A free, offline suite gets run often.

**In the code.** `describeDocument()` and `extractDocument()`. The schema tests
assert on the generated JSON Schema, so the tool definition — the actual
prompt — is regression-tested offline.

**Evidence.** `npm test`: 64 tests, no API key, no network, nothing billed.

**Check yourself.** Q15: Why does it matter that the schema tests check the
*generated JSON Schema* rather than only parsing sample objects?

### 5.2 Secrets at the edge

**Key idea.** Parse `process.env` through Zod once at startup; fail with a
readable message; never put the key in an error, log or trace.

**Why it matters.** "ANTHROPIC_API_KEY is not set" beats a 401 or a stack trace.
A key in a log is noticed only after it lands in a bug report. Node 20.12+ has
`process.loadEnvFile()`, so `dotenv` is unnecessary.

**In the code.** `src/llm/env.ts`, with a test in `env.test.ts` asserting the
value never appears in errors.

**Check yourself.** Q16: Why have a test for something as simple as "don't log
the key"?

### 5.3 A runtime key cannot carry a compile-time type

**Key idea.** Looking up a schema by a runtime string honestly yields `unknown`;
accept it rather than cast it away.

**Why it matters.** With two registry entries the lookup returns a union that
cannot unify to one type. The CLI only serialises, so it loses nothing; the eval
harness uses `DOCUMENT_TYPES.table` directly to keep the precise type. The
compiler only complained once a *second* type existed: a registry of one is
indistinguishable from a constant.

**In the code.** `getDocumentType` in `src/schemas/registry.ts`.

**Check yourself.** Q17: When should code use `DOCUMENT_TYPES.table` instead of
`getDocumentType("table")`?

### 5.4 Check the contract, not the tutorial

**Key idea.** LLM API surfaces drift fast; verify advice against the current
model and the installed library before building on it.

**Why it matters.** Three findings so far came from checking, not from docs:
`temperature` now returns 400, LangChain v1 renamed content-block fields, and
strict tools cap unions at 16. One cheap experimental call is worth more than an
hour of reasoning.

**In the code.** Undated model aliases only (`claude-sonnet-5`, never a
date-pinned snapshot), so the code follows the current contract.

**Check yourself.** Q18: The project plan itself said "learn why extraction uses
temperature 0". What does that teach about your own plans?

---

## Answer key

Try each question before reading its answer.

| Q | Answer |
| --- | --- |
| 1 | You lose the layout — which value belongs to which row and column, which is exactly what a skewed table needs. You gain cheaper text tokens and visible failures, but the structure is gone for good. |
| 2 | Resize the image first. It risks small print becoming unreadable, likely hurting the sparse columns that already drift. On this table, output is two-thirds of the bill, so a smaller image alone will not halve it. |
| 3 | A tool definition built from the JSON Schema, plus `tool_choice` forcing that tool. The model returns tool-call arguments, not text. |
| 4 | No. `.superRefine()` does not survive conversion, so the model never sees it; it only rejects afterwards. Put the rule in a `.describe()` too. |
| 5 | Nothing. A missing key could mean "none" or "forgot". With `.nullable()`, `footnotes: null` is a claim the eval can score. |
| 6 | No. Every nullable field is a union and the limit is 16, so you would have to drop nullability — the thing that stops invention. Zod already validates the arguments. |
| 7 | Text. Typing as a number forces the model to decide on the spot that `—` means `0` or `null`, with no record of what was printed. Interpret later in code you can fix without re-extracting. |
| 8 | A summary can only be scored against a human reference; a transcription can be diffed against the page. Mixing them blurs what you are measuring. |
| 9 | It restates the name. A useful description resolves what the model would guess at: which row is the header, whether a unit printed below belongs to it. |
| 10 | Only that the output has the right shape — nothing about whether the values are true. |
| 11 | No. Self-reported scores are not calibrated; the model says ~0.95 to almost everything, and the drifted table said `high`. |
| 12 | You would lose `usage_metadata`, and with it token counts and cost. Re-parsing keeps both the cost and a specific error message for the repair loop. |
| 13 | A tighter schema (descriptions, nullability), a clearer prompt, then validation with a repair retry. Not `temperature`, which returns 400. |
| 14 | Every registered type is a label the classifier can pick by mistake, routing real documents into a schema that cannot hold them. |
| 15 | The JSON Schema is what the model actually reads. Testing it catches a description that went missing or a field that turned optional, which parsing samples never shows. |
| 16 | Because it fails silently and is noticed only after a key leaks into a bug report or trace. |
| 17 | Whenever the type is known at compile time, such as in the eval harness, so the result keeps its precise type. Use the registry only for runtime choices. |
| 18 | Plans encode the advice of the day they were written. Check them against the current contract before building on them. |
