import { describe, it, expect } from "vitest";
import { computeRSI, computeEMA, computeMACD, computeTAForSymbol, fetchAndUpsertTA } from "./ta.ts";

describe("computeRSI", () => {
  it("computes RSI correctly for a known sequence", () => {
    const closes = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const rsi = computeRSI(closes);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThan(0);
    expect(rsi!).toBeLessThan(100);
  });

  it("returns null when not enough data", () => {
    expect(computeRSI([1, 2, 3])).toBeNull();
  });

  it("returns 100 when all gains", () => {
    const closes = Array.from({ length: 16 }, (_, i) => 100 + i);
    expect(computeRSI(closes)).toBe(100);
  });

  it("returns 0 when all losses", () => {
    const closes = Array.from({ length: 16 }, (_, i) => 200 - i);
    expect(computeRSI(closes)).toBe(0);
  });

  it("returns exactly period+1 minimum data points", () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 + Math.sin(i));
    expect(computeRSI(closes, 14)).not.toBeNull();
    expect(computeRSI(closes.slice(0, 14), 14)).toBeNull();
  });
});

describe("computeEMA", () => {
  it("computes EMA", () => {
    const values = [1, 2, 3, 4, 5];
    const ema = computeEMA(values, 3);
    expect(ema.length).toBe(5);
    expect(ema[0]).toBe(1);
    expect(ema[4]!).toBeGreaterThan(ema[0]!);
  });

  it("returns empty for empty input", () => {
    expect(computeEMA([], 3)).toEqual([]);
  });

  it("single value returns itself", () => {
    expect(computeEMA([42], 5)).toEqual([42]);
  });
});

describe("computeMACD", () => {
  it("computes MACD with enough data", () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const macd = computeMACD(closes);
    expect(macd).not.toBeNull();
    expect(typeof macd!.macd).toBe("number");
    expect(typeof macd!.signal).toBe("number");
    expect(typeof macd!.histogram).toBe("number");
    expect(macd!.histogram).toBeCloseTo(macd!.macd - macd!.signal);
  });

  it("returns null when not enough data", () => {
    expect(computeMACD([1, 2, 3])).toBeNull();
  });
});

describe("computeTAForSymbol", () => {
  it("produces a summary with symbol name", async () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({
      t: new Date(i * 60000).toISOString(),
      o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
    }));
    const result = await computeTAForSymbol("ETH", bars);
    expect(result.symbol).toBe("ETH");
    expect(result.summary).toContain("ETH");
    expect(result.rsi).not.toBeNull();
    expect(result.macd).not.toBeNull();
  });

  it("handles insufficient bars gracefully", async () => {
    const bars = [{ t: "t", o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }];
    const result = await computeTAForSymbol("X", bars);
    expect(result.rsi).toBeNull();
    expect(result.macd).toBeNull();
  });
});

describe("fetchAndUpsertTA", () => {
  it("skips when no symbols", async () => {
    // Should not throw
    await fetchAndUpsertTA({
      getSymbols: async () => new Set(),
      fetchBarsFn: async () => [],
    });
  });

  it("handles fetch failures gracefully", async () => {
    await fetchAndUpsertTA({
      getSymbols: async () => new Set(["BTC", "ETH"]),
      fetchBarsFn: async () => { throw new Error("network"); },
    });
    // Should not throw — errors are caught internally
  });
});
