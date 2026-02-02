import { describe, it, expect, mock, beforeEach } from "bun:test";
import { getAlpacaSymbolSet, fetchAndUpsertCMCData, fetchCryptoQuotes, fetchGlobalMetrics, fetchTrending } from "./coinmarketcap.ts";
import { storage } from "./storage.ts";

beforeEach(async () => {
  await storage.clear();
});

describe("getAlpacaSymbolSet", () => {
  it("extracts and deduplicates base symbols from Alpaca trading pairs", async () => {
    const mockAssets = async () => [
      { id: "1", symbol: "BTC/USD", name: "Bitcoin", status: "active", tradable: true },
      { id: "2", symbol: "BTC/USDT", name: "Bitcoin", status: "active", tradable: true },
      { id: "3", symbol: "BTC/USDC", name: "Bitcoin", status: "active", tradable: true },
      { id: "4", symbol: "ETH/USD", name: "Ethereum", status: "active", tradable: true },
      { id: "5", symbol: "ETH/BTC", name: "Ethereum", status: "active", tradable: true },
      { id: "6", symbol: "DOGE/USD", name: "Dogecoin", status: "active", tradable: true },
      { id: "7", symbol: "USDT/USD", name: "Tether", status: "active", tradable: true },
      { id: "8", symbol: "USDC/USD", name: "USDC", status: "active", tradable: true },
    ];
    const set = await getAlpacaSymbolSet(mockAssets);
    expect(set).toEqual(new Set(["BTC", "ETH", "DOGE"]));
    expect(set.has("USDT")).toBe(false);
    expect(set.has("USDC")).toBe(false);
  });

  it("handles concatenated symbols like BTCUSD", async () => {
    const set = await getAlpacaSymbolSet(async () => [
      { id: "1", symbol: "BTCUSD", name: "Bitcoin", status: "active", tradable: true },
      { id: "2", symbol: "ETHUSD", name: "Ethereum", status: "active", tradable: true },
    ]);
    expect(set.has("BTC")).toBe(true);
    expect(set.has("ETH")).toBe(true);
  });

  it("returns empty set for no assets", async () => {
    const set = await getAlpacaSymbolSet(async () => []);
    expect(set.size).toBe(0);
  });
});

describe("fetchAndUpsertCMCData", () => {
  it("fetches quotes only for Alpaca-tradeable symbols and filters trending", async () => {
    const mockAssets = async () => [
      { id: "1", symbol: "BTC/USD", name: "Bitcoin", status: "active", tradable: true },
      { id: "2", symbol: "ETH/USD", name: "Ethereum", status: "active", tradable: true },
    ];

    const mockFetch = mock((url: string) => {
      if (url.includes("quotes/latest?symbol=")) {
        expect(url).toContain("BTC");
        expect(url).toContain("ETH");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: {
              BTC: { quote: { USD: { price: 65000, volume_24h: 30e9, market_cap: 1.2e12, percent_change_1h: 0.5, percent_change_24h: 2.1, percent_change_7d: -1.3, percent_change_30d: 8.0 } } },
              ETH: { quote: { USD: { price: 3500, volume_24h: 15e9, market_cap: 4e11, percent_change_1h: 0.3, percent_change_24h: 1.5, percent_change_7d: -0.8, percent_change_30d: 5.0 } } },
            },
          }),
        });
      }
      if (url.includes("global-metrics")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: { btc_dominance: 54.2, eth_dominance: 17.1, active_cryptocurrencies: 9500, quote: { USD: { total_market_cap: 2.4e12 } } },
          }),
        });
      }
      if (url.includes("trending")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              { name: "Bitcoin", symbol: "BTC", slug: "bitcoin" },
              { name: "Solana", symbol: "SOL", slug: "solana" },
              { name: "Ethereum", symbol: "ETH", slug: "ethereum" },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("Not found") });
    }) as any;

    await fetchAndUpsertCMCData({ fetchFn: mockFetch, getAssets: mockAssets });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("skips when no Alpaca assets available", async () => {
    const mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
    await fetchAndUpsertCMCData({ fetchFn: mockFetch, getAssets: async () => [] });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
