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
wrong date or figure. Milestones 2, 3, and 7 (schemas, null-instead-of-guess
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
prompt (milestone 4), and validation (milestone 7) — not from a sampling knob.

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


---

## Milestone 2 — First structured extraction

**Built:** `extract <file> --type <table|prose>` — a page image goes in,
validated typed JSON comes out.

- `src/schemas/fields.ts` — reusable field builders carrying the design rules.
- `src/schemas/dataTable.ts`, `prose.ts` — the two types the corpus actually has.
- `src/schemas/registry.ts` — key → schema; the seam the classifier plugs into.
- `src/extract/extractDocument.ts` — schema-agnostic; the model is a parameter.

### 1. "Structured output" is tool calling wearing a different hat

The tempting approach is to ask for JSON in the prompt and `JSON.parse()` the
reply. It mostly works, which is the problem — it fails on the documents you
care about, by fencing the JSON in markdown, prefixing "Here is the JSON", or
trailing a comma.

`withStructuredOutput(schema, ...)` is categorically different:

```
Zod schema  ->  JSON Schema  ->  an Anthropic *tool definition*
                                 + tool_choice: { type: "tool", name }
```

The model is not asked for JSON; it is required to call a function whose
arguments are the fields. Argument generation is constrained by the API rather
than requested in prose, so the whole "it replied with a sentence and then the
JSON" category cannot occur.

*Gotcha worth knowing:* LangChain stops forcing `tool_choice` if `thinking` is
set explicitly on the client — it warns and merely hopes the tool gets called.
`src/llm/models.ts` does not set it, so this works today. If that changes, the
alternative is `method: "jsonSchema"`, which uses Anthropic's native
`output_config.format` and forces nothing.

### 2. The schema is a prompt, and the conversion decides what the model hears

The idea to carry into every later milestone. The schema is not only a
validator — it is converted and handed to the model, so **what survives the
conversion is instruction, and what does not is invisible**:

| Zod | JSON Schema | Model sees it? |
| --- | --- | --- |
| `.describe("...")` | `description` | **Yes** |
| `.nullable()` | `type: ["string","null"]` | **Yes**, key stays required |
| `.optional()` | removed from `required` | **Yes** |
| `.regex()`, `.min()`, `.length()` | `pattern`, `minLength`, `maxLength` | **Yes** |
| `.refine()` | nothing | **No** |
| `.trim()` | nothing | **No** (still applies on parse) |

So a rule has two possible homes, and the choice is not stylistic. A rule the
model should *follow* must survive the conversion. A rule checked only
*afterwards* is invisible by construction — it can reject an answer, never
improve one.

`dataTable.ts` states one rule in **both** homes on purpose: "every row has
exactly one cell per column" appears in the `rows` description (which the model
reads) *and* in a `.superRefine()` (which enforces it). A description cannot
enforce; a refinement cannot persuade. Together they are what "validate and
repair" will mean in milestone 7, and the failure message is already written to
be handed back to the model.

That rule earns the effort because a ragged row is the most damaging table
error there is: every cell after the missing one lands in the wrong column, so
the output is perfectly well-formed and completely wrong.

A constraint in the wrong home is a silent bug: `.refine()` on a field *looks*
like it is guiding extraction and does nothing of the kind.

### 3. `.nullable()`, not `.optional()`

They look interchangeable. `.optional()` lets the model omit the key, so "I
looked and it is not there" and "I forgot" become the same output. `.nullable()`
keeps the key required and allows `null`, making absence an explicit, countable
claim. Milestone 3 can measure null-correctness; it cannot measure an absent key.

The prompt's "return null rather than guessing" is the other half of this rule —
this is the half that holds when the prompt is ignored.

Same reasoning gives `minLength: 1` on text: an empty string is neither a value
nor an admission of absence, and would score as wrong while looking successful.

### 4. `includeRaw: true`, and the silent `null` behind it

Two things that only turn up by reading the installed source.

**Without `includeRaw: true` you lose the bill.** The default returns only the
parsed object, discarding the `AIMessage` and with it `usage_metadata` — no
token count, no cost.

**With it, validation failures stop throwing.** LangChain catches them and sets
`parsed: null`. A bare `null` is a bad failure report: "returned nothing" and
"wrote the date as 01/10/2026" need different responses.

So `extractDocument` runs `safeParse` itself on the tool call's arguments. On
the happy path that is a redundant validation costing microseconds; when
something is wrong it is the difference between `null` and `issueDate: expected
an ISO date, YYYY-MM-DD` — the string milestone 7 will feed back to the model.

### 5. `strict: true` and nullability are in direct conflict

Anthropic tool definitions accept `strict: true`, guaranteeing the arguments
validate. Our schema met the documented preconditions, so it should have been
free. The API disagreed:

```
400: Schemas contains too many parameters with union types (17 parameters with
type arrays or anyOf) ... (limit: 16 parameters with unions).
```

Exactly 17, easy to count: 7 nullable scalars, 3 each in `seller` and `buyer`,
4 in the line item — because **every nullable field is a union**. The rule from
§3 is what produced the 17.

The two features are mutually exclusive on any schema of real size, and the
choice is not close: `strict` guarantees well-typed arguments, which Zod already
gives us with a better error message; `.nullable()` is what stops invention, and
nothing substitutes for it. Nullability wins.

The generalisable point: provider features interact with schema design in ways
no tutorial mentions. A limit like "16 unions" only appears in a 400 from a real
request. Budget one cheap experimental call instead of reasoning about it.

### 6. Type documents by what you want from them, not by what they are

The instinct for a nutrient table is to model nutrients — `energyKj`, `protein`,
`fat`. It is a trap: every new layout needs a new schema, an unanticipated
column vanishes silently, and the model must decide invisibly that "Retinol ekv.
µg" is your `vitaminA` field.

`dataTable.ts` captures what a table *is* — headings, columns, rows, footnotes.
One schema reads a nutrient table, a price list, and a spec sheet, and an
unexpected column is just a column. What it gives up is queryability; that
interpretation still happens, just afterwards, in deterministic code, on text
you can still read.

Same reasoning keeps cells as **text**. A printed cell can be `12,5`, `< 0,1`,
`n.a.`, `—`, or `1 200`. Parsing those during extraction means the model decides
what each means on the spot, and `—` quietly becomes `0` with no record that the
page said otherwise.

**The principle is bigger than tables: give the model the job only it can do
(reading the page), and keep the job ordinary code does better (interpreting
consistent text) out of the prompt.** Every rule moved out of the model stops
being probabilistic — and can be fixed without re-paying for the extraction.

### 7. Prose has no fields, so the schema has to encode a question

A table has fields because the document has fields. Prose does not.
"Extract this prose document" is meaningless until you say what you want:

| Question | Schema | Scorable? |
| --- | --- | --- |
| What does the page say? | transcription + metadata | Yes — diff against the page |
| What is the page about? | summary + entities | Only against a human reference |
| What are the answers to X? | targeted facts | Yes, if X is fixed up front |

`prose.ts` is the first. Every field is something printed, so the model only
reads and never judges — which is what makes it measurable. The other two belong
as separate document types later, not as extra fields here: they fail
differently and deserve separate measurement.

### 8. The finding that matters most: validation passed and values were still wrong

Running the real `Tápanyagtáblázat` photo through `--type table`:

- 12 columns, 32 rows, every row exactly 12 cells — the alignment rule passed.
- All 32 Hungarian food names correct and in order.
- The section divider "Gabonafélék, kenyerek, pékáruk" diverted to `notes`
  instead of being forced into a row; the handwritten corner note reported in
  `warnings`.
- Decimal commas and `-` preserved exactly as printed.
- The hard part done right: the page is a *skewed photograph*, so each label on
  the left sits lower than its own values on the right. The model paired them
  correctly anyway, 32 to 32, no off-by-one. A classical OCR pipeline, which
  flattens the page to text before reasoning, is exactly where that fails.

And yet — spot-checking the sparse right-hand columns (Magnézium, Retinol,
E-vitamin, mostly dashes) turns up several cells that appear to have drifted a
row. `35,0` shows up as one row's Magnézium *and* the next row's Kalcium.

**Every check was green.** Zod passed, the row-width rule passed, the model
reported `confidence: "high"` with no relevant warning. The output is
well-formed, plausible, and in places wrong — the vision-model failure mode from
milestone 1 §2, arriving exactly as predicted.

Three consequences, which reordered the roadmap:

1. **Schema validation is not accuracy.** It proves shape. Nothing in the
   pipeline yet has an opinion about whether the answer is *true*.
2. **The eval harness moved ahead of prompt engineering.** "It looks right" does
   not survive a 384-cell table; these were found by accident and the method
   cannot be trusted to find the rest.
3. **Preprocessing is an accuracy lever, not only a cost lever.** The errors
   cluster in the sparse columns of a skewed photo — which is what deskewing
   addresses. Now a testable hypothesis.

Honest caveat: this came from comparing against a skewed photo by eye, which is
the unreliable method being argued against. It is a reason to build the eval,
not a measurement.

### 9. A runtime key cannot carry a compile-time type

With two registry entries, `getDocumentType(key)` stopped type-checking: a
lookup by runtime string returns a union of entries with different schemas,
which cannot unify to one inferred type.

The fix is to accept it rather than cast it away. `getDocumentType` returns the
widened `DocumentType`, so extracting through it yields `unknown` — which is the
truth, because a type decided at runtime genuinely has no compile-time identity.
The CLI only serialises, so it loses nothing; the eval harness will use
`DOCUMENT_TYPES.table` directly and keep the precise type.

Worth noticing the compiler only raised this once a *second* type existed. A
registry with one entry is indistinguishable from a constant.

### 10. Notes for the classifier (milestone 6)

- **It must be able to abstain.** On a mixed corpus the most important answer is
  "none of these" → review queue. Without it, every document is forced into the
  nearest schema and the pipeline produces confident garbage. This is the
  `null`-instead-of-guess rule one level up — and the mismatched-schema run
  (verification notes) proved its value: that result was only clean because the
  model was *allowed* to say "this is not the expected document".
- **Do not register a type the corpus does not contain.** Not harmless: it is a
  label the classifier can pick by mistake, and every false positive routes a
  real document into a schema that cannot hold it.
- **Do not classify when you already know.** `--type` is free and cannot be
  wrong; a classifier costs a call and can be. It earns its place only for
  genuinely mixed, unlabelled input. That is why `--type` is *required* rather
  than defaulted — a default would silently read a prose page with the table
  schema and return a confident, empty result.

One alternative worth recording: all schemas can be offered as separate tools in
a *single* call, letting the model pick which to fill — one step, lower latency.
It loses at scale, because every tool definition sits in the prompt on every
call. Two calls also lets the cheap model do the easy half, and ages better.

### 11. The recipe: designing a schema for a new document type

For whatever comes after `table` and `prose`. Copying an existing schema is the
wrong move — repeat the exercise:

1. **Put a real document in front of you** and list what a careful human would
   point at. Nothing derived, nothing computed.
2. **One field, one thing on the page.** Merging is where the model gets room to
   be creative, and creativity is the failure mode.
3. **Reach for `fields.ts` first.** Add a helper there when a second type needs
   the same kind of field.
4. **Write descriptions that resolve ambiguity, not ones that restate the
   name.** `header: "the column header"` says nothing. Useful ones answer a
   question the model would otherwise guess at: *which* row is the header,
   whether a unit printed under it belongs to it, what a `—` in a cell means. If a careful reader would
   hesitate, write a sentence.
5. **Every scalar nullable, nothing optional** (§3).
6. **Spread in `extractionMeta`** so every type reports confidence and warnings
   the same way.
7. **Describe the object itself** — the top-level `.describe()` becomes the tool
   description.
8. **Register it** — one line. Extraction never names a schema, so nothing else
   changes.
9. **Test what the model sees**, not only what the validator accepts. The schema
   tests assert that every field is required and described; those properties
   decay silently otherwise, one hurried `.optional()` at a time.

On `confidence` being three words rather than a number: a model asked for a
0.0-1.0 score answers 0.95 to almost everything. Self-reported probabilities are
not calibrated — the number looks quantitative and measures nothing. Three
buckets are a judgement it can make, and enough to route to a human. Real
confidence comes from measured accuracy and validation, never from self-opinion.

### Verification notes

- `npm test`: 64 tests, **no API key and no network**, nothing billed. The schema
  tests assert on the generated JSON Schema, so the tool definition — the actual
  prompt — is regression tested offline.
- `npm run typecheck` clean under `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`.
- **Table path**, real photo: structure exact (32×12, no ragged rows), labels
  exact, values partly wrong in the sparse columns — §8. 5,250 in / 1,879 out,
  $0.029. Note the output cost: a full table writes every cell, and output is
  billed at 5x input.
- **Prose path**, synthetic letter: verbatim transcription, paragraph breaks and
  signature line breaks preserved, `## ` headings, `2026. marcius 14.` →
  `2026-03-14`, language `hu`, no invention. 3,747 in / 432 out, $0.012.
- **Null-correctness**, nutrition table read with a schema for a different
  document type, before the pivot: every field `null`, `confidence: "low"`, one warning naming what the
  page actually was. The model declined to invent a document that was not there.
- Still missing: a **real scanned** example of each type with hand-written
  ground truth. The synthetic samples prove the wiring and nothing about skew,
  noise, or handwriting.

---

## Hardening — scope

- **Removed the invoice schema.** It was an unregistered worked example; the
  project is for tables and prose only. Its unused field helpers (`money`,
  `quantity`, `currencyCode`) went with it. Dead code that reads like a feature
  misleads people and Claude Code alike, and it would tempt someone to register it.
