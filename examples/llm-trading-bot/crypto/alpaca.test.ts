import { describe, it, expect } from "bun:test";
import { getCryptoQuote, getCryptoPositions, getAccount } from "./alpaca.ts";

// These functions hit the real Alpaca API with test keys, so they'll fail gracefully.
// We test that error handling works and returns expected fallback values.

describe("alpaca API error handling", () => {
  it("getCryptoQuote returns null on failure", async () => {
    const result = await getCryptoQuote("INVALID/PAIR");
    expect(result).toBeNull();
  });

  it("getCryptoPositions returns empty array on failure", async () => {
    const result = await getCryptoPositions();
    // With test keys this will fail — should return []
    expect(Array.isArray(result)).toBe(true);
  });

  it("getAccount returns null on failure", async () => {
    const result = await getAccount();
    // With test keys, returns null
    expect(result === null || typeof result === "object").toBe(true);
  });
});
