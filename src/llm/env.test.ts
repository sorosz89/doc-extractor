import { describe, it, expect } from "vitest";
import { readEnv, EnvError } from "./env.js";

const VALID_KEY = "sk-ant-test-key-not-real";

describe("readEnv", () => {
  it("returns the key when it is present and well-formed", () => {
    expect(readEnv({ ANTHROPIC_API_KEY: VALID_KEY }).ANTHROPIC_API_KEY).toBe(VALID_KEY);
  });

  it("names the missing variable without a stack-trace-shaped message", () => {
    expect(() => readEnv({})).toThrow(EnvError);
    expect(() => readEnv({})).toThrow(/ANTHROPIC_API_KEY is not set/);
    expect(() => readEnv({})).toThrow(/Copy \.env\.example/);
  });

  it("rejects a key that does not look like an Anthropic key", () => {
    expect(() => readEnv({ ANTHROPIC_API_KEY: "sk-proj-openai-style" })).toThrow(/ANTHROPIC_API_KEY: does not look like an Anthropic key/);
  });

  it("never puts the secret in the error message", () => {
    // The whole point of validating here: an error that leaks the key into
    // logs or a bug report is worse than no validation at all.
    const secret = "sk-ant-SUPERSECRET";
    try {
      readEnv({ ANTHROPIC_API_KEY: secret, LANGSMITH_API_KEY: "" });
      expect.unreachable("expected readEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain("SUPERSECRET");
    }
  });

  it("treats the LangSmith variables as optional until milestone 8", () => {
    expect(() => readEnv({ ANTHROPIC_API_KEY: VALID_KEY })).not.toThrow();
    expect(readEnv({ ANTHROPIC_API_KEY: VALID_KEY }).LANGSMITH_API_KEY).toBeUndefined();
  });
});
