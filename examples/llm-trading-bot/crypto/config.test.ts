import { describe, it, expect } from "vitest";
import { config, keys, requireEnv, ALPACA_TRADING_BASE, ALPACA_CRYPTO_DATA_BASE } from "./config.ts";

describe("config", () => {
  it("has expected default values", () => {
    expect(config.CRYPTO_TICKER).toBe("BTC/USD");
    expect(config.POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(config.MAX_POSITION_SIZE_USD).toBeGreaterThan(0);
    expect(config.COOLDOWN_MS).toBeGreaterThan(0);
    expect(config.MAX_TRADES_PER_DAY).toBeGreaterThan(0);
    expect(typeof config.PAPER).toBe("boolean");
    expect(typeof config.LLM_MODEL).toBe("string");
  });

  it("uses paper trading base URL by default", () => {
    expect(ALPACA_TRADING_BASE).toContain("paper");
  });

  it("crypto data base URL is set", () => {
    expect(ALPACA_CRYPTO_DATA_BASE).toContain("data.alpaca.markets");
  });
});

describe("requireEnv", () => {
  it("returns test fallback in test mode", () => {
    const val = requireEnv("SOME_NONEXISTENT_VAR");
    expect(val).toBe("test-some_nonexistent_var");
  });
});

describe("keys", () => {
  it("has all required keys populated (test fallbacks)", () => {
    expect(typeof keys.OPENAI_API_KEY).toBe("string");
    expect(typeof keys.PERIGON_API_KEY).toBe("string");
    expect(typeof keys.APCA_KEY).toBe("string");
    expect(typeof keys.APCA_SECRET).toBe("string");
    expect(typeof keys.CCC_API_KEY).toBe("string");
  });
});
