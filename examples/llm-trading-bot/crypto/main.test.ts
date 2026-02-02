import { describe, it, expect, vi } from "vitest";
import { runOnce } from "./main.ts";
import { createTradingState } from "./trading.ts";
import type { Decision } from "./decision.ts";

describe("runOnce", () => {
  it("invokes fetchNews, fetchCMCData, fetchTA, decide, execute, reportPerformance in order", async () => {
    const calls: string[] = [];
    const deps = {
      fetchNews: vi.fn(async () => { calls.push("fetchNews"); }),
      fetchCMCData: vi.fn(async () => { calls.push("fetchCMCData"); }),
      fetchTA: vi.fn(async () => { calls.push("fetchTA"); }),
      reportPerformance: vi.fn(async () => { calls.push("reportPerformance"); }),
      decide: vi.fn(async () => {
        calls.push("decide");
        return { action: "hold", ticker: "BTC/USD", size_usd: 0, confidence: 1, rationale: "" } as Decision;
      }),
      execute: vi.fn(async (_d: Decision) => { calls.push("execute"); }),
      logger: vi.fn(() => {}),
    };

    await runOnce(deps, createTradingState());
    expect(calls).toContain("fetchNews");
    expect(calls).toContain("fetchCMCData");
    expect(calls).toContain("fetchTA");
    expect(calls).toContain("decide");
    expect(calls).toContain("execute");
    expect(calls).toContain("reportPerformance");
    expect(calls.indexOf("decide")).toBeGreaterThan(calls.indexOf("fetchNews"));
    expect(calls.indexOf("decide")).toBeGreaterThan(calls.indexOf("fetchCMCData"));
    expect(calls.indexOf("decide")).toBeGreaterThan(calls.indexOf("fetchTA"));
    expect(calls.indexOf("reportPerformance")).toBeGreaterThan(calls.indexOf("execute"));
  });

  it("handles null decision gracefully", async () => {
    const executeMock = vi.fn(async () => {});
    await runOnce({
      fetchNews: async () => {},
      fetchCMCData: async () => {},
      fetchTA: async () => {},
      reportPerformance: async () => {},
      decide: async () => null,
      execute: executeMock,
      logger: () => {},
    }, createTradingState());
    expect(executeMock).not.toHaveBeenCalled();
  });
});
