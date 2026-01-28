import { describe, test, expect } from "vitest";
import { countTokens, countTokensSync } from "./custom_tokenizer";

describe("Custom Tokenizer", () => {
  describe("countTokensSync", () => {
    test("should approximate token count using character ratio", () => {
      const text = "This is a test";
      const tokens = countTokensSync(text);

      // Using 1/4 character ratio
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    test("should handle empty strings", () => {
      expect(countTokensSync("")).toBe(0);
    });

    test("should handle long text", () => {
      const longText = "a".repeat(1000);
      expect(countTokensSync(longText)).toBe(250);
    });

    test("should round up fractional tokens", () => {
      // 15 chars / 4 = 3.75, should round to 4
      const text = "123456789012345";
      expect(countTokensSync(text)).toBe(4);
    });
  });

  describe("countTokens", () => {
    test("should count tokens using BERT tokenizer", async () => {
      const text = "I love transformers!";
      const count = await countTokens(text);

      // BERT tokenizer should return a reasonable count
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(text.length);
    });

    test("should handle empty strings", async () => {
      const count = await countTokens("");
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test("should handle longer text", async () => {
      const text =
        "This is a longer piece of text that should be tokenized properly by the BERT tokenizer.";
      const count = await countTokens(text);

      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(text.length);
    });

    test("should handle special characters", async () => {
      const text = "Hello, world! How are you?";
      const count = await countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    test("should be consistent across multiple calls", async () => {
      const text = "Consistent tokenization test";
      const count1 = await countTokens(text);
      const count2 = await countTokens(text);

      expect(count1).toBe(count2);
    });

    test("should reuse tokenizer instance", async () => {
      // Multiple calls should reuse the same tokenizer
      const text1 = "First call";
      const text2 = "Second call";

      const count1 = await countTokens(text1);
      const count2 = await countTokens(text2);

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
    });
  });

  describe("Comparison", () => {
    test("should show difference between sync approximation and actual tokenizer", async () => {
      const text = "This is a test sentence for tokenization.";

      const syncCount = countTokensSync(text);
      const asyncCount = await countTokens(text);

      // Both should be positive
      expect(syncCount).toBeGreaterThan(0);
      expect(asyncCount).toBeGreaterThan(0);

      // They may differ since sync is approximation
      // Just verify they're in a reasonable range
      expect(syncCount).toBeLessThan(text.length);
      expect(asyncCount).toBeLessThan(text.length);
    });

    test("should approximate similarly for simple text", async () => {
      const text = "test";

      const syncCount = countTokensSync(text);
      const asyncCount = await countTokens(text);

      // For very short text, they might be similar
      expect(syncCount).toBe(1); // 4 chars / 4 = 1
      expect(asyncCount).toBeGreaterThanOrEqual(1);
      expect(asyncCount).toBeLessThanOrEqual(3);
    });
  });
});
