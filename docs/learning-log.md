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
