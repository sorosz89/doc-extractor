import { z } from "zod";
import { extractionMeta, isoDate, languageCode, nullableText } from "./fields.js";

/**
 * A page of running text — a letter, an article, a leaflet, a report page.
 *
 * WHY THIS SCHEMA LOOKS SO DIFFERENT FROM THE OTHERS
 *
 * A table has fields because the document has fields. Prose does
 * not. "Extract this prose document" has no meaning on its own — the schema has
 * to encode a *question*, and different questions give completely different
 * schemas:
 *
 *   transcription + metadata  -> what the page says, preserved
 *   summary + entities        -> what the page is about
 *   targeted facts            -> the answers to a fixed list of questions
 *
 * This is the first. Every field is something printed on the page, so the model
 * is only ever reading, never judging. That matters more than it sounds: a
 * summary field cannot be wrong in a way a test can detect without a human
 * writing the reference summary, whereas a transcription can be diffed against
 * the page by anyone. The eval harness in milestone 3 can actually score this.
 *
 * The other two kinds are worth adding later as separate document types rather
 * than extra fields here — an interpretation schema and a transcription schema
 * have different failure modes and deserve to be measured separately.
 *
 * COST: this is the one schema whose output is not small. A dense page can run
 * to a couple of thousand output tokens, billed at 5x input. That is the honest
 * price of a faithful transcription, and `maxTokens` in `src/llm/models.ts` is
 * set generously for exactly this reason.
 */

export const proseSchema = z
  .object({
    title: nullableText(
      "The document's title or main heading, as printed. Null if the page carries none — do not invent one from the opening sentence.",
    ),

    documentKind: nullableText(
      'What kind of document this is, in a few words: "letter", "newspaper article", "product leaflet", "handwritten note", "book page". Your own description, based on how the page looks and reads.',
    ),

    language: languageCode("The language the document is written in."),

    date: isoDate(
      "The date printed on the document itself — when it was written, issued, or published. Null if the page shows no date. Do not use today's date.",
    ),

    authors: z
      .array(z.string())
      .describe(
        "Everyone credited as an author, writer, or sender, as printed. An empty array if the document names nobody — which is common and perfectly fine.",
      ),

    text: z
      .string()
      .min(1)
      .nullable()
      .describe(
        [
          "The full text of the page, transcribed.",
          "",
          "Transcribe, do not rewrite. Keep the original language — never translate. Keep the original wording, spelling, and punctuation, including mistakes. Do not summarise, do not shorten, do not tidy, and do not add anything that is not printed.",
          "",
          "Light structure is welcome where the page has it: separate paragraphs with a blank line, and prefix a heading with '## '. Preserve line breaks only where they are meaningful, as in an address, a poem, or a list; let ordinary prose reflow.",
          "",
          "Where the page is damaged or illegible, write [illegible] in place of the missing words rather than guessing at them, and say what happened in warnings.",
          "",
          "Null only if the page contains no readable text at all.",
        ].join("\n"),
      ),

    ...extractionMeta,
  })
  .describe(
    "The text of a prose document, transcribed faithfully, with the metadata printed on the page. This is a transcription task: the value of the output is that it says exactly what the page says.",
  );

export type ProseDocument = z.infer<typeof proseSchema>;
