import OpenAI from "openai";

// Light wrapper to ensure API key is present and scoped to the example.
export function makeOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run the example server");
  }
  return new OpenAI({ apiKey });
}
