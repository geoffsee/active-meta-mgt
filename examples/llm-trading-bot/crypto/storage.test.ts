import { describe, it, expect, beforeEach } from "vitest";
import {
  storage, getJSON, setJSON,
  appendDecisionLog, getDecisionLog,
  appendTradeLog, getTradeLog,
  recordBuyEntry, recordSellExit, getOpenPositions, getCompletedTrades,
  appendPortfolioSnapshot, getStartingEquity, setStartingEquity,
} from "./storage.ts";

beforeEach(async () => {
  try { await storage.clear(); } catch {}
});

describe("getJSON / setJSON", () => {
  it("stores and retrieves a value", async () => {
    await setJSON("test-key", { foo: 42 });
    const val = await getJSON<{ foo: number }>("test-key");
    expect(val?.foo).toBe(42);
  });

  it("returns null for missing key", async () => {
    expect(await getJSON("nonexistent")).toBeNull();
  });
});

describe("decision log", () => {
  it("appends and retrieves entries", async () => {
    await appendDecisionLog({ timestamp: "t1", action: "buy", ticker: "BTC/USD", confidence: 0.9, size_usd: 100, rationale: "test" });
    await appendDecisionLog({ timestamp: "t2", action: "sell", ticker: "ETH/USD", confidence: 0.8, size_usd: 50, rationale: "test2" });
    const log = await getDecisionLog();
    expect(log.length).toBe(2);
    expect(log[0]!.ticker).toBe("BTC/USD");
    expect(log[1]!.action).toBe("sell");
  });

  it("returns empty array when nothing stored", async () => {
    expect(await getDecisionLog()).toEqual([]);
  });
});

describe("trade log", () => {
  it("appends and retrieves entries", async () => {
    await appendTradeLog({ timestamp: "t1", side: "buy", ticker: "BTC/USD", qty: 1, notional: 5000 });
    const log = await getTradeLog();
    expect(log.length).toBe(1);
    expect(log[0]!.side).toBe("buy");
  });
});

describe("round-trip tracking", () => {
  it("records buy entry and sell exit with P/L", async () => {
    await recordBuyEntry("BTC/USD", 1000);
    const open = await getOpenPositions();
    expect(open.length).toBe(1);
    expect(open[0]!.entryNotional).toBe(1000);

    const completed = await recordSellExit("BTC/USD", 1100);
    expect(completed).not.toBeNull();
    expect(completed!.pnl).toBe(100);
    expect(completed!.win).toBe(true);
    expect(completed!.pnlPct).toBeCloseTo(10);

    const openAfter = await getOpenPositions();
    expect(openAfter.length).toBe(0);
  });

  it("accumulates on same ticker", async () => {
    await recordBuyEntry("ETH/USD", 500);
    await recordBuyEntry("ETH/USD", 300);
    const open = await getOpenPositions();
    expect(open.length).toBe(1);
    expect(open[0]!.entryNotional).toBe(800);
  });

  it("returns null when selling unknown ticker", async () => {
    const result = await recordSellExit("DOGE/USD", 100);
    expect(result).toBeNull();
  });

  it("records a loss correctly", async () => {
    await recordBuyEntry("SOL/USD", 1000);
    const completed = await recordSellExit("SOL/USD", 900);
    expect(completed!.pnl).toBe(-100);
    expect(completed!.win).toBe(false);
  });

  it("getCompletedTrades returns history", async () => {
    try { await storage.clear(); } catch {}
    await recordBuyEntry("A/USD", 100);
    await recordSellExit("A/USD", 120);
    await recordBuyEntry("B/USD", 200);
    await recordSellExit("B/USD", 180);
    const trades = await getCompletedTrades();
    expect(trades.length).toBe(2);
    expect(trades[0]!.win).toBe(true);
    expect(trades[1]!.win).toBe(false);
  });
});

describe("portfolio snapshots", () => {
  it("stores and retrieves starting equity", async () => {
    await setStartingEquity(10000);
    expect(await getStartingEquity()).toBe(10000);
  });

  it("appends snapshot", async () => {
    await appendPortfolioSnapshot({
      timestamp: "t1", equity: 10000, cash: 5000, positionValue: 5000, positions: [],
    });
    // No getter for snapshots exposed, just verify no throw
  });
});
