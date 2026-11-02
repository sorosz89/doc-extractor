import { z } from "zod";

/**
 * Environment handling.
 *
 * Two rules worth internalising early, because an API key is a bearer token
 * that costs real money:
 *
 *  1. Validate at the edge, once. Everything downstream gets a typed object
 *     and never touches `process.env` again.
 *  2. Never put a secret in an error message, a log line, or a trace. The
 *     messages below name the *variable*, never its value.
 */

const envSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY is set but empty")
    .refine((key) => key.startsWith("sk-ant-"), {
      // A wrong-looking key fails here, locally and for free, instead of
      // costing a round trip and returning an opaque 401.
      message: "does not look like an Anthropic key (expected it to start with 'sk-ant-')",
    }),

  // Milestone 8. Absent until then, hence optional.
  LANGSMITH_TRACING: z.enum(["true", "false"]).optional(),
  LANGSMITH_API_KEY: z.string().min(1).optional(),
  LANGSMITH_PROJECT: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown when the environment is unusable. Carries no secret material. */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/**
 * Load `.env` into `process.env` if the file exists.
 *
 * Node has had this built in since 20.12, so the `dotenv` dependency that most
 * tutorials still reach for is no longer needed.
 */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file is fine — the vars may come from the shell or CI.
  }
}

/**
 * Validate the environment and return it typed.
 *
 * Takes the raw environment as a parameter so tests can exercise it without
 * mutating the real `process.env`.
 */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => {
        const variable = issue.path.join(".");
        // `invalid_type` on a missing key reads as "expected string, received
        // undefined", which buries the actual problem.
        return issue.code === "invalid_type" && source[variable] === undefined
          ? `  - ${variable} is not set`
          : `  - ${variable}: ${issue.message}`;
      })
      .join("\n");

    throw new EnvError(
      `Environment is not configured:\n${problems}\n\nCopy .env.example to .env and fill it in.`,
    );
  }

  return result.data;
}
