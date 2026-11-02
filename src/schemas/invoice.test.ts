import { describe, it, expect } from "vitest";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { invoiceSchema, type Invoice } from "./invoice.js";

/**
 * Two kinds of test live in this file, and the second kind is the interesting
 * one.
 *
 * The obvious kind checks that the schema accepts good data and rejects bad
 * data — ordinary validator tests.
 *
 * The other kind checks **what the model is told**. `withStructuredOutput()`
 * sends the model this schema converted to JSON Schema, so the conversion
 * output is a prompt, and asserting on it is how a prompt gets regression
 * tested. The two properties asserted below — every field required, every field
 * described — are the schema-level anti-hallucination rules from `fields.ts`,
 * and both are the sort of thing that decays silently: one `.optional()` added
 * in a hurry and the model is free to omit a field again, with no test failing
 * anywhere else.
 */

/** The JSON Schema that actually reaches the model as the tool's input_schema. */
const jsonSchema = toJsonSchema(invoiceSchema) as JsonSchemaNode;

interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
}

/** Every `properties` entry in the schema, keyed by dotted path. */
function collectFields(node: JsonSchemaNode, path = ""): Array<[string, JsonSchemaNode]> {
  const found: Array<[string, JsonSchemaNode]> = [];

  for (const [name, child] of Object.entries(node.properties ?? {})) {
    const childPath = path ? `${path}.${name}` : name;
    found.push([childPath, child]);
    // Objects reached through a nullable union sit inside `anyOf`.
    for (const branch of [child, ...(child.anyOf ?? []), ...(child.items ? [child.items] : [])]) {
      found.push(...collectFields(branch, childPath));
    }
  }

  return found;
}

const fields = collectFields(jsonSchema);

describe("the invoice schema as the model sees it", () => {
  it("describes itself, which becomes the tool description", () => {
    expect(jsonSchema.description).toMatch(/return null/i);
  });

  it("requires every field, so a missing one cannot be confused with an absent value", () => {
    // This is `.nullable()` rather than `.optional()`, enforced. If a field were
    // optional, the model could omit the key and we could not tell whether it
    // looked and found nothing, or simply forgot.
    const optionalFields = Object.keys(jsonSchema.properties ?? {}).filter(
      (name) => !(jsonSchema.required ?? []).includes(name),
    );

    expect(optionalFields).toEqual([]);
  });

  it("describes every field, including nested ones", () => {
    // A field description is the only explanation of that field the model gets.
    const undescribed = fields.filter(([, node]) => !node.description).map(([path]) => path);

    expect(undescribed).toEqual([]);
  });

  it("lets every scalar field be null", () => {
    const allowsNull = (node: JsonSchemaNode): boolean =>
      (Array.isArray(node.type) && node.type.includes("null")) ||
      (node.anyOf ?? []).some((branch) => branch.type === "null");

    expect(allowsNull(jsonSchema.properties!.invoiceNumber!)).toBe(true);
    expect(allowsNull(jsonSchema.properties!.total!)).toBe(true);
    expect(allowsNull(jsonSchema.properties!.issueDate!)).toBe(true);
  });

  it("passes format constraints through to the model, not just to the validator", () => {
    // `.regex()` and `.length()` survive the conversion, so the model is told
    // the shape of a date and of a currency code. `.refine()` would not survive
    // — which is why business rules live in milestone 7 instead of here.
    const issueDate = jsonSchema.properties!.issueDate!;
    const currency = jsonSchema.properties!.currency!;

    expect(issueDate.anyOf?.some((branch) => branch.pattern === "^\\d{4}-\\d{2}-\\d{2}$")).toBe(true);
    expect(currency.anyOf?.some((branch) => branch.minLength === 3 && branch.maxLength === 3)).toBe(true);
  });

  it("offers confidence as three words rather than a number", () => {
    // A self-reported 0.0-1.0 score from an LLM is not calibrated. Three
    // buckets are a judgement it can actually make. See fields.ts.
    expect(jsonSchema.properties!.confidence!.enum).toEqual(["high", "medium", "low"]);
  });
});

const validInvoice: Invoice = {
  invoiceNumber: "2026/114",
  issueDate: "2026-10-01",
  dueDate: "2026-10-15",
  seller: { name: "Acme Kft.", address: "Budapest, Fő utca 1.", taxId: "HU12345678" },
  buyer: { name: "Globex Ltd.", address: null, taxId: null },
  currency: "HUF",
  lineItems: [{ description: "Consulting", quantity: 2, unitPrice: 50_000, amount: 100_000 }],
  subtotal: 100_000,
  taxAmount: 27_000,
  total: 127_000,
  confidence: "high",
  warnings: [],
};

describe("invoiceSchema validation", () => {
  it("accepts a complete invoice", () => {
    expect(invoiceSchema.safeParse(validInvoice).success).toBe(true);
  });

  it("accepts nulls for anything the document does not show", () => {
    const sparse: Invoice = {
      ...validInvoice,
      invoiceNumber: null,
      dueDate: null,
      currency: null,
      subtotal: null,
      taxAmount: null,
      lineItems: [],
      confidence: "low",
      warnings: ["The lower third of the page is cut off."],
    };

    expect(invoiceSchema.safeParse(sparse).success).toBe(true);
  });

  it("rejects a missing key, which is what makes nullable different from optional", () => {
    const { invoiceNumber: _omitted, ...withoutInvoiceNumber } = validInvoice;

    expect(invoiceSchema.safeParse(withoutInvoiceNumber).success).toBe(false);
  });

  it("rejects an empty string, which is neither a value nor an admission of absence", () => {
    const result = invoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "" });

    expect(result.success).toBe(false);
  });

  it("rejects a date that is not ISO, with a message worth feeding back to the model", () => {
    const result = invoiceSchema.safeParse({ ...validInvoice, issueDate: "01/10/2026" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/ISO date/);
  });

  it("rejects a number sent as a string, the most common model slip on money fields", () => {
    const result = invoiceSchema.safeParse({ ...validInvoice, total: "127000" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["total"]);
  });

  it("trims whitespace the scan leaves behind", () => {
    const result = invoiceSchema.safeParse({ ...validInvoice, invoiceNumber: "  2026/114  " });

    expect(result.data?.invoiceNumber).toBe("2026/114");
  });
});
