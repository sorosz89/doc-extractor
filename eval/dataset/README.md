# Evaluation dataset

Drop your scanned documents here. **Nothing in this folder is committed except
this README and the ground-truth JSON** — see the note at the bottom.

## Milestone 1: just one file

Put a single scan here and run:

```bash
npm run describe -- eval/dataset/your-scan.png
```

Supported now: `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`. PDFs arrive in milestone 5.
Keep it under ~3.5 MB on disk — base64 inflates it by a third and the API caps a
single image at 5 MB.

A good first scan is slightly imperfect: a real receipt or invoice photographed
at an angle teaches more than a pristine export, because the interesting
failures only show up on imperfect input.

## Milestone 4 onward: ground truth

From the eval harness on, each scan is paired with a hand-written ground-truth
JSON of the same basename:

```
eval/dataset/
├─ invoice-001.png
├─ invoice-001.json      <- what the correct answer is, written by you
├─ receipt-003.jpg
└─ receipt-003.json
```

The JSON matches the Zod schema for that document type (milestone 2) and is
written *by hand, from the image* — never by copying the model's output, which
would make the eval measure nothing but its own agreement with itself.

Aim for 10–20 scans per document type, and deliberately include the hard cases:
skewed, low-resolution, handwritten, stamped, multi-page, and at least one with
genuinely missing fields so null-correctness can be measured.

## Privacy

Real invoices and receipts carry names, addresses, card numbers, and bank
details, and every scan here gets sent to an API. Decide per file whether it
should exist outside this machine. Images are gitignored by default for exactly
this reason; if you want to commit a sample, redact it first.
