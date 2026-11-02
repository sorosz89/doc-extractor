import { describe, it, expect } from "vitest";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { proseSchema, type ProseDocument } from "./prose.js";

const letter: ProseDocument = {
  title: "Értesítés",
  documentKind: "letter",
  language: "hu",
  date: "2026-03-14",
  authors: ["Kovács Anna"],
  text: "Tisztelt Olvasó!\n\nEz a levél a tájékoztatás céljából készült.\n\nÜdvözlettel,\nKovács Anna",
  confidence: "high",
  warnings: [],
};

describe("the prose schema as the model sees it", () => {
  const jsonSchema = toJsonSchema(proseSchema) as {
    description?: string;
    properties?: Record<string, { description?: string; anyOf?: Array<{ minLength?: number }> }>;
    required?: string[];
  };

  it("frames the task as transcription, not interpretation", () => {
    expect(jsonSchema.description).toMatch(/transcri/i);
  });

  it("requires every field", () => {
    const optional = Object.keys(jsonSchema.properties ?? {}).filter(
      (name) => !(jsonSchema.required ?? []).includes(name),
    );

    expect(optional).toEqual([]);
  });

  it("tells the model the three rules that keep a transcription honest", () => {
    const text = jsonSchema.properties?.text?.description ?? "";

    expect(text).toMatch(/never translate/i);
    expect(text).toMatch(/do not summarise/i);
    // A marker rather than a guess, so an unreadable passage stays visible in
    // the output instead of being quietly filled in.
    expect(text).toMatch(/\[illegible\]/);
  });
});

describe("proseSchema validation", () => {
  it("accepts a transcribed letter", () => {
    expect(proseSchema.safeParse(letter).success).toBe(true);
  });

  it("preserves paragraph breaks verbatim", () => {
    const parsed = proseSchema.parse(letter);

    expect(parsed.text).toContain("\n\n");
    expect(parsed.text).toBe(letter.text);
  });

  it("accepts an unsigned, undated, untitled page", () => {
    const anonymous: ProseDocument = {
      ...letter,
      title: null,
      date: null,
      authors: [],
      documentKind: "handwritten note",
    };

    expect(proseSchema.safeParse(anonymous).success).toBe(true);
  });

  it("accepts null text only as a statement that the page has none", () => {
    const blank: ProseDocument = { ...letter, text: null, confidence: "low", warnings: ["Blank page."] };

    expect(proseSchema.safeParse(blank).success).toBe(true);
  });

  it("rejects an empty transcription, which claims nothing either way", () => {
    expect(proseSchema.safeParse({ ...letter, text: "" }).success).toBe(false);
  });

  it("rejects a language name where a code belongs", () => {
    const result = proseSchema.safeParse({ ...letter, language: "Hungarian" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["language"]);
  });
});
