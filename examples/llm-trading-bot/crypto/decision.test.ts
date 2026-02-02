import { describe, it, expect, vi } from "vitest";
import { synthesizeAndDecide, isValidDecision } from "./decision.ts";
import type { Decision } from "./decision.ts";
import { config } from "./config.ts";

function mockOpenAi(decision: Decision) {
  return {
    chat: {
      completions: {
        create: vi.fn(() => ({
          choices: [{ message: { content: JSON.stringify(decision) } }],
        } as any)),
      },
    },
  } as any;
}

const baseDeps = {
  context: {
    synthesizeFromLanes: vi.fn(() => Promise.resolve()),
    buildLLMContextPayload: vi.fn(() => ({ workingMemory: { text: "ctx" } })),
  },
  getCryptoQuoteFn: vi.fn(() => Promise.resolve({ bid: 50000, ask: 50100, mid: 50050 })),
  getCryptoPositionsFn: vi.fn(() => Promise.resolve([])),
  getAlpacaSymbolsFn: vi.fn(() => Promise.resolve(new Set(["BTC", "ETH"]))),
};

describe("isValidDecision", () => {
  it("accepts a valid decision", () => {
    expect(isValidDecision({ action: "buy", ticker: "BTC/USD", size_usd: 100, confidence: 0.9, rationale: "bull" })).toBe(true);
  });

  it("rejects missing ticker", () => {
    expect(isValidDecision({ action: "buy", size_usd: 100, confidence: 0.9, rationale: "bull" })).toBe(false);
  });

  it("rejects empty ticker", () => {
    expect(isValidDecision({ action: "buy", ticker: "", size_usd: 100, confidence: 0.9, rationale: "bull" })).toBe(false);
  });

  it("rejects invalid action", () => {
    expect(isValidDecision({ action: "short", ticker: "BTC/USD", size_usd: 100, confidence: 0.9, rationale: "x" })).toBe(false);
  });

  it("rejects non-finite size_usd", () => {
    expect(isValidDecision({ action: "buy", ticker: "BTC/USD", size_usd: NaN, confidence: 0.9, rationale: "x" })).toBe(false);
  });

  it("rejects null input", () => {
    expect(isValidDecision(null)).toBe(false);
  });
});

describe("synthesizeAndDecide", () => {
  it("passes through parsed decision", async () => {
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      openaiClient: mockOpenAi({ action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "bullish" }),
    });

    expect(decision?.action).toBe("buy");
    expect(decision?.ticker).toBe("BTC/USD");
    expect(decision?.size_usd).toBeLessThanOrEqual(config.MAX_POSITION_SIZE_USD);
  });

  it("clamps confidence to [0,1]", async () => {
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      openaiClient: mockOpenAi({ action: "hold", ticker: "ETH/USD", confidence: 5, size_usd: 0, rationale: "test" }),
    });
    expect(decision?.confidence).toBe(1);
  });

  it("clamps size_usd to max position size", async () => {
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      openaiClient: mockOpenAi({ action: "buy", ticker: "ETH/USD", confidence: 0.9, size_usd: 999999, rationale: "test" }),
    });
    expect(decision?.size_usd).toBe(config.MAX_POSITION_SIZE_USD);
  });

  it("returns hold on invalid LLM JSON", async () => {
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      openaiClient: {
        chat: { completions: { create: vi.fn(() => ({ choices: [{ message: { content: "not json" } }] })) } },
      },
    });
    expect(decision?.action).toBe("hold");
  });

  it("returns hold when LLM decision fails validation", async () => {
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      openaiClient: mockOpenAi({ action: "short" as any, ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "x" }),
    });
    expect(decision?.action).toBe("hold");
  });

  it("returns null on synthesis error", async () => {
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      context: { synthesizeFromLanes: vi.fn(() => { throw new Error("boom"); }), buildLLMContextPayload: vi.fn(() => ({})) },
      openaiClient: mockOpenAi({ action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "x" }),
    });
    expect(decision).toBeNull();
  });

  it("truncates rationale to 800 chars", async () => {
    const longRationale = "x".repeat(1000);
    const decision = await synthesizeAndDecide({
      ...baseDeps,
      openaiClient: mockOpenAi({ action: "hold", ticker: "BTC/USD", confidence: 0.5, size_usd: 0, rationale: longRationale }),
    });
    expect(decision?.rationale.length).toBe(800);
  });

  it("includes positions in LLM prompt", async () => {
    const createSpy = vi.fn(() => ({
      choices: [{ message: { content: JSON.stringify({ action: "hold", ticker: "BTC/USD", confidence: 0.9, size_usd: 0, rationale: "ok" }) } }],
    }));
    await synthesizeAndDecide({
      ...baseDeps,
      getCryptoPositionsFn: vi.fn(() => Promise.resolve([
        { symbol: "BCHUSD", qty: "10", asset_class: "crypto", market_value: "5000" },
      ])),
      openaiClient: { chat: { completions: { create: createSpy } } },
    });
    const userMsg = (createSpy.mock.calls[0] as any)[0].messages[1].content;
    expect(userMsg).toContain("BCHUSD");
    expect(userMsg).toContain("qty=10");
  });
});
