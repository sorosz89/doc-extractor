# Evaluation dataset

Your scans live here. **Nothing in this folder is committed except this README
and the ground-truth JSON** — see Privacy below.

## Now: run a scan through a schema

```bash
npm run extract -- eval/dataset/your-table.jpg --type table
npm run extract -- eval/dataset/your-letter.png --type prose
```

`--type` is required — there is no classifier yet, and a default would silently
read one kind of page with the wrong schema and return a confident, empty
result.

Supported: `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`. PDFs arrive in milestone 5.
Keep files under ~3.5 MB on disk; base64 inflates them by a third and the API
caps a single image at 5 MB.

## Milestone 3 onward: ground truth

The eval harness pairs each scan with a hand-written ground-truth JSON of the
same basename:

```
eval/dataset/
├─ table-001.jpg
├─ table-001.json      <- the correct answer, written by you
├─ letter-003.png
└─ letter-003.json
```

The JSON matches that document type's Zod schema, and is written **by hand,
from the image** — never by copying the model's output, which would make the
eval measure nothing but its own agreement with itself.

Aim for 10–20 scans per type, and include the hard cases deliberately: skewed,
low-resolution, handwritten, stamped, multi-page, and at least one page that is
*not* the type being tested, so null-correctness and the classifier's ability
to abstain can both be measured.

Why this matters more than it sounds: a real table extraction has already
passed Zod, passed the row-width rule, and reported `confidence: "high"` with
several cells wrong (`docs/course.md` lesson 3.1). Validation proves shape, not
truth. Ground truth is the only thing that proves truth.

## Privacy

Real scans carry names, addresses, and other personal data, and every file here
gets sent to an API. Decide per file whether it should exist outside this
machine. Images are gitignored by default for exactly that reason; redact
before committing a sample.
