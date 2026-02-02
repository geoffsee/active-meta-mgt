import { describe, it, expect, mock } from "bun:test";
import { runOnce } from "./main.ts";
import { createTradingState } from "./trading.ts";
import type { Decision } from "./decision.ts";

describe("runOnce", () => {
  it("invokes fetchNews, fetchCMCData, fetchTA, decide, execute, reportPerformance in order", async () => {
    const calls: string[] = [];
    const deps = {
      fetchNews: mock(async () => { calls.push("fetchNews"); }),
      fetchCMCData: mock(async () => { calls.push("fetchCMCData"); }),
      fetchTA: mock(async () => { calls.push("fetchTA"); }),
      reportPerformance: mock(async () => { calls.push("reportPerformance"); }),
      decide: mock(async () => {
        calls.push("decide");
        return { action: "hold", ticker: "BTC/USD", size_usd: 0, confidence: 1, rationale: "" } as Decision;
      }),
      execute: mock(async (_d: Decision) => { calls.push("execute"); }),
      logger: mock(() => {}),
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
    const executeMock = mock(async () => {});
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
