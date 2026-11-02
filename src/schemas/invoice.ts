import { z } from "zod";
import {
  currencyCode,
  extractionMeta,
  isoDate,
  money,
  nullableText,
  quantity,
} from "./fields.js";

/**
 * The invoice schema — the worked example for every document type that follows.
 *
 * Read `fields.ts` first: it explains which parts of a Zod schema the model
 * actually sees. This file is about the next question, which is harder and has
 * no library answer: *what fields should there be, and how should they be
 * described?*
 *
 * The four rules this file follows, in rough order of how much they matter:
 *
 * 1. ONE FIELD, ONE THING ON THE PAGE. Every field here corresponds to
 *    something a person could point at. No `customerDetails: string` holding
 *    four facts, no computed fields. If the model has to merge or derive, it
 *    has room to be creative, and creativity is the failure mode.
 *
 * 2. DESCRIBE THE AMBIGUITY, NOT THE FIELD. `invoiceNumber: "the invoice
 *    number"` tells the model nothing it did not know. The description is worth
 *    writing when it resolves a choice the model would otherwise have to guess
 *    at: which of two numbers on the page, who is the seller when both
 *    addresses look alike, what to do when the total appears twice. Those are
 *    the descriptions below that are long.
 *
 * 3. EVERY SCALAR IS NULLABLE. Not because every field is optional in a legal
 *    sense, but because the alternative to `null` is invention. See `fields.ts`.
 *
 * 4. THE TOP-LEVEL `.describe()` BECOMES THE TOOL DESCRIPTION. It is the
 *    model's answer to "what am I being asked to do here", and it is the right
 *    place for instructions that apply to the whole document rather than to one
 *    field.
 *
 * Adding a type (receipt, delivery note, nutrition table) means repeating this
 * exercise, not copying this file: ask what is on *that* page, and where a
 * careful reader would hesitate. The recipe is written up in
 * `docs/learning-log.md` under milestone 2.
 */

/**
 * A party to the transaction: who issued the invoice, and who owes the money.
 *
 * Deliberately an always-present object with nullable fields, rather than a
 * nullable object. "The seller block exists but the tax ID is missing" and "I
 * could not find a seller at all" are different facts about the page, and
 * flattening them into one `null` loses the difference — which milestone 3
 * would then be unable to measure.
 *
 * Move this to `fields.ts` when a second document type needs it; it is here
 * until there is a second caller to prove the shape is right.
 */
function party(role: string, whoThatIs: string) {
  return z
    .object({
      name: nullableText(`The ${role}'s full legal or trading name.`),
      address: nullableText(
        `The ${role}'s postal address as one line, in the document's own order. Keep the original wording — do not translate or reformat it.`,
      ),
      taxId: nullableText(
        `The ${role}'s tax, VAT, or company registration number, including any country prefix (for example "HU12345678"). Null if the document shows none.`,
      ),
    })
    .describe(
      `The ${role}: ${whoThatIs}. Both parties' blocks look alike on most invoices, so decide by role rather than by position on the page.`,
    );
}

const lineItem = z
  .object({
    description: nullableText("The item or service as written on the line."),
    quantity: quantity("How many units this line covers."),
    unitPrice: money("The price of a single unit, before tax if the document separates it."),
    amount: money("The total for this line. Read it from the page; do not multiply it out yourself."),
  })
  .describe("One billed line of the invoice.");

export const invoiceSchema = z
  .object({
    invoiceNumber: nullableText(
      'The invoice\'s own identifier, usually labelled "Invoice no.", "Számla sorszám", or similar. If several numbers appear, choose the one identifying this document — not a customer number, order number, or bank reference.',
    ),
    issueDate: isoDate("The date the invoice was issued."),
    dueDate: isoDate("The date payment is due. Null if the document states no due date."),

    seller: party("seller", "the party that issued the invoice and receives the payment"),
    buyer: party("buyer", "the party being invoiced, who owes the payment"),

    currency: currencyCode("The currency of the amounts on this invoice."),

    lineItems: z
      .array(lineItem)
      .describe(
        "Every billed line, in the order they appear. Include each line exactly once, and skip the table's own subtotal or total rows — those belong in the fields below. An empty array if the invoice bills a single sum with no itemisation.",
      ),

    subtotal: money("The net total before tax. Null if the invoice shows no separate net figure."),
    taxAmount: money("The total tax or VAT charged. Null if no tax is shown."),
    total: money(
      "The final amount payable, tax included — the figure the buyer actually owes. If the document shows several totals, take the one marked as payable.",
    ),

    ...extractionMeta,
  })
  .describe(
    "Fields read from a scanned invoice. Report only what is visible on the page. Where a field is not present, return null — never a guess, never a placeholder, and never a value carried over from a similar document. Transcribe values as the document shows them; the only normalisation asked for is dates and number formatting, as described per field.",
  );

/** The validated shape. `z.infer` keeps the type and the schema in lockstep. */
export type Invoice = z.infer<typeof invoiceSchema>;
