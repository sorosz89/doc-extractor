# Learning log

The project journal: one short entry per milestone, newest last. It records
what was built and what was found. The lessons themselves live in
[`course.md`](course.md), organised by concept with quiz questions; this file
just points to them.

Each entry: **Built** · **Found** · **Lessons** · **Verified**.

---

## Milestone 1 — Hello vision

**Built:** project scaffold (strict TypeScript, Vitest, env handling, CLI) and
`describe <file>`: one page image in, free-text description plus token counts
and cost out.

**Found:**

- LangChain v1 content blocks use `mimeType` / `data`; most published examples
  still show the v0.3 shape. The installed types were the only reliable source.
- Sonnet 5 rejects `temperature` with a 400; the roadmap's "temperature 0 for
  extraction" was already out of date. `effort` replaced it.
- `dotenv` is unnecessary: Node 20.12+ has `process.loadEnvFile()`.

**Lessons:** [1.1](course.md#11-vision-not-ocr) ·
[1.2](course.md#12-where-the-bill-goes) ·
[4.1](course.md#41-effort-not-temperature) ·
[5.1](course.md#51-the-model-is-a-parameter) ·
[5.2](course.md#52-secrets-at-the-edge) ·
[5.4](course.md#54-check-the-contract-not-the-tutorial)

**Verified:** 24 tests, no API key, no network; typecheck clean under `strict`
+ `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.

---

## Milestone 2 — First structured extraction

**Built:** `extract <file> --type <table|prose>`: a page image in, validated
typed JSON out. `fields.ts` (field builders), `dataTable.ts`, `prose.ts`,
`registry.ts`, and a schema-agnostic `extractDocument.ts`.

**Found:**

- `strict: true` fails with 17 unions against a limit of 16. Every nullable
  field is a union, so nullability wins.
- `includeRaw: true` keeps the token counts but turns validation errors into
  `parsed: null`; we re-run `safeParse` to keep the message.
- **The real table passed every check and was still partly wrong.** 32 × 12,
  no ragged rows, labels exact, `confidence: "high"`, yet several sparse-column
  cells drifted a row. This reordered the roadmap: the eval comes before prompt
  engineering.
- With two registry entries, a runtime lookup can only return `unknown`. The eval
  will use `DOCUMENT_TYPES.table` directly.

**Lessons:** [2.1](course.md#21-structured-output-is-tool-calling) ·
[2.2](course.md#22-the-schema-is-a-prompt) ·
[2.3](course.md#23-nullable-not-optional) ·
[2.4](course.md#24-strict-true-vs-nullability) ·
[2.5](course.md#25-type-by-structure-not-subject) ·
[2.6](course.md#26-prose-has-no-fields-so-the-schema-encodes-a-question) ·
[2.7](course.md#27-designing-a-schema-for-a-new-document-type) ·
[3.1](course.md#31-validation-is-not-accuracy) ·
[3.2](course.md#32-confidence-in-words-not-numbers) ·
[3.3](course.md#33-keep-the-failure-message) ·
[4.2](course.md#42-routing-and-abstention) ·
[5.3](course.md#53-a-runtime-key-cannot-carry-a-compile-time-type)

**Verified:** 64 tests offline; typecheck clean.

| Run | Result | Tokens in / out | Cost |
| --- | --- | --- | --- |
| Table, real skewed photo | Structure exact; sparse columns partly wrong | 5,250 / 1,879 | $0.029 |
| Prose, synthetic letter | Verbatim, dates normalised, no invention | 3,747 / 432 | $0.012 |
| Table read with a mismatched schema | All `null`, `confidence: "low"`, warning named the real type | — | — |

Still missing: a real scan of each type with hand-written ground truth.

---

## Hardening — scope

**Built:** removed the invoice schema and its unused helpers (`money`,
`quantity`, `currencyCode`).

**Found:** dead code that looks like a feature misleads people and Claude Code
alike, and an unregistered type is one step away from being registered. See
[4.2](course.md#42-routing-and-abstention).

---

## Milestone 3 — Evaluation harness

**Built:** `npm run eval`. Truth files (`<name>.truth.json`, or
`.local.truth.json` for third-party text) validated by the extraction schemas;
scorers for tables (cell-by-cell, by position) and prose (CER plus fields);
invented/omitted counts; cost, latency, tokens; `--repeat`, `--baseline`,
`--effort`; results saved to `eval/results/`.

**Found:**

- The first baseline failed both pages while reading the text almost perfectly
  (CER 0.00% and 0.12%). Fields are where it went wrong.
- Page 2 got an **invented title**: two section headings joined together.
- Authors came back with credentials and the site name. Was that the model's
  error or the schema's? The schema says "as printed", so it never decided.
- A **confabulated warning**: the model misread `sütéskor` as `süléskor`, then
  reported the typo as being in the source.
- Both failures reported `confidence: "high"`.
- **Synthetic table** (`eval/synthetic/make_table.py`, so the truth is exact by
  construction): 384/384 cells right on a clean render, $0.031. The table
  title came back `null`, because the schema doesn't say whether a subtitle
  under the page heading is the table's caption. A clean render is the upper
  bound; the gap to the skewed photo is milestone 5's to close.

**Lessons:** [6.1](course.md#61-ground-truth-comes-from-the-page-not-the-model) ·
[6.2](course.md#62-count-the-two-null-errors-separately) ·
[6.3](course.md#63-a-rate-for-text-a-verdict-for-fields) ·
[6.4](course.md#64-the-eval-finds-the-schemas-gaps) ·
[6.5](course.md#65-self-reports-are-not-evidence) ·
[6.6](course.md#66-baselines-and-repeats)

**Verified:** 91 tests offline; typecheck clean. First real run: 2 prose
pages, 0% pass, $0.042 total, 13.1 s per page.

Still missing: ground truth for the real skewed Tápanyagtáblázat photo,
truth for the scanned `Fitoosztrogen.jpg` page, and more samples per type.
