import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeDecision, createTradingState, loadTradingState, saveTradingState } from "./trading.ts";
import { config } from "./config.ts";
import { storage } from "./storage.ts";

const baseDeps = {
  getCryptoPositions: vi.fn(() => Promise.resolve([{ symbol: "BTCUSD", qty: "0.1", asset_class: "crypto", market_value: "5000" }])),
  placeCryptoMarketBuy: vi.fn(() => Promise.resolve({ id: "buy123" })),
  placeCryptoMarketSell: vi.fn(() => Promise.resolve({ id: "sell123" })),
  now: () => 0,
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), debug: vi.fn(() => {}), warn: vi.fn(() => {}) },
};

beforeEach(async () => {
  try { await storage.clear(); } catch {}
});

describe("executeDecision", () => {
  it("enforces cooldown", async () => {
    const state = createTradingState();
    state.lastTradeAt = 0;
    const result = await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "" },
      { ...baseDeps, now: () => config.COOLDOWN_MS - 1 },
      state,
    );
    expect(result.status).toBe("cooldown");
  });

  it("places buy order when allowed", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    const result = await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "" },
      { ...baseDeps, getCryptoPositions: vi.fn(() => Promise.resolve([])) },
      state,
    );
    expect(result.status).toBe("buy_placed");
    expect((result as any).orderId).toBe("buy123");
  });

  it("sells positions when requested", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    const result = await executeDecision(
      { action: "sell", ticker: "BTC/USD", confidence: 0.9, size_usd: 0, rationale: "" },
      baseDeps,
      state,
    );
    expect(result.status).toBe("sell_completed");
  });

  it("returns hold for hold decision", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    const result = await executeDecision(
      { action: "hold", ticker: "BTC/USD", confidence: 0.9, size_usd: 0, rationale: "" },
      baseDeps,
      state,
    );
    expect(result.status).toBe("hold");
  });

  it("respects max position size", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    const result = await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 1000, rationale: "" },
      { ...baseDeps, getCryptoPositions: vi.fn(() => Promise.resolve([{ symbol: "BTCUSD", qty: "0.1", asset_class: "crypto", market_value: "5000" }])) },
      state,
    );
    expect(result.status).toBe("max_position");
  });

  it("respects daily trade limit", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    state.tradesToday = config.MAX_TRADES_PER_DAY;
    // Use dayKeyET to match what resetDailyCountersIfNeeded computes for now()=0
    const { dayKeyET } = await import("./time.ts");
    state.tradeDayKey = dayKeyET(new Date(0));
    const result = await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "" },
      { ...baseDeps, getCryptoPositions: vi.fn(() => Promise.resolve([])) },
      state,
    );
    expect(result.status).toBe("daily_limit");
  });

  it("rejects low confidence", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    const result = await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.01, size_usd: 500, rationale: "" },
      baseDeps,
      state,
    );
    expect(result.status).toBe("low_confidence");
  });

  it("blocks when circuit breaker tripped", async () => {
    const state = createTradingState();
    state.circuitBreakerTripped = true;
    const result = await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "" },
      baseDeps,
      state,
    );
    expect(result.status).toBe("circuit_breaker");
  });

  it("returns sell_none when no matching position", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    const result = await executeDecision(
      { action: "sell", ticker: "ETH/USD", confidence: 0.9, size_usd: 0, rationale: "" },
      baseDeps,
      state,
    );
    expect(result.status).toBe("sell_none");
  });

  it("trips circuit breaker on buy exchange error", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "" },
      {
        ...baseDeps,
        getCryptoPositions: vi.fn(() => Promise.resolve([])),
        placeCryptoMarketBuy: vi.fn(() => { throw new Error("exchange down"); }),
      },
      state,
    );
    expect(state.circuitBreakerTripped).toBe(true);
  });

  it("does NOT trip circuit breaker on sizing error", async () => {
    const state = createTradingState();
    state.lastTradeAt = -config.COOLDOWN_MS;
    await executeDecision(
      { action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 500, rationale: "" },
      {
        ...baseDeps,
        getCryptoPositions: vi.fn(() => Promise.resolve([])),
        placeCryptoMarketBuy: vi.fn(() => { throw new Error("integer qty required"); }),
      },
      state,
    );
    expect(state.circuitBreakerTripped).toBe(false);
  });
});

describe("tradingState persistence", () => {
  it("saves and loads state", async () => {
    const state = createTradingState();
    state.lastTradeAt = 12345;
    state.tradesToday = 3;
    state.tradeDayKey = "2025-01-01";
    await saveTradingState(state);
    const loaded = await loadTradingState();
    expect(loaded.lastTradeAt).toBe(12345);
    expect(loaded.tradesToday).toBe(3);
  });

  it("returns fresh state when nothing stored", async () => {
    const loaded = await loadTradingState();
    expect(loaded.lastTradeAt).toBe(0);
    expect(loaded.tradesToday).toBe(0);
  });
});
