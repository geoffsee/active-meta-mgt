import { config, keys } from "./config.ts";
import { traderContext } from "./clients.ts";
import { getAlpacaCryptoAssets } from "./alpaca.ts";
import type { CryptoAsset } from "./alpaca.ts";
import { createLogger } from "./logger.ts";
import { getJSON, setJSON } from "./storage.ts";

const log = createLogger("crypto-cmc");

const CMC_BASE = "https://pro-api.coinmarketcap.com";

type FetchFn = typeof globalThis.fetch;

export async function cmcFetch(path: string, fetchFn: FetchFn = globalThis.fetch): Promise<any> {
  const url = `${CMC_BASE}${path}`;
  const res = await fetchFn(url, {
    headers: {
      "X-CMC_PRO_API_KEY": keys.CCC_API_KEY,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`CMC ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Returns the set of base symbols tradeable on Alpaca (e.g. {"BTC","ETH","DOGE"}) */
/** Returns the set of base symbols tradeable on Alpaca (e.g. {"BTC","ETH","DOGE"}) */
export async function getAlpacaSymbolSet(
  getAssets: () => Promise<CryptoAsset[]> = getAlpacaCryptoAssets,
): Promise<Set<string>> {
  const assets = await getAssets();
  // Alpaca crypto symbols are trading pairs: "BTC/USD", "ETH/USDT", "BTC/USDC", etc.
  // We extract base symbols and exclude stablecoins/fiat that aren't interesting to track.
  const stablecoins = new Set(["USD", "USDT", "USDC", "USDG"]);
  const bases = new Set<string>();
  const quoteSuffixes = ["USD", "USDT", "USDC", "BTC", "USDG"];

  for (const a of assets) {
    const sym = a.symbol;
    if (sym.includes("/")) {
      const base = sym.split("/")[0];
      if (base && !stablecoins.has(base)) bases.add(base);
    } else {
      // Fallback: strip known quote suffixes from concatenated symbols like "BTCUSD"
      let matched = false;
      for (const q of quoteSuffixes) {
        if (sym.endsWith(q) && sym.length > q.length) {
          const base = sym.slice(0, -q.length);
          if (base && !stablecoins.has(base)) { bases.add(base); matched = true; break; }
        }
      }
      if (!matched && sym && !stablecoins.has(sym)) bases.add(sym);
    }
  }
  return bases;
}

const CMC_CACHE_TTL_MS = 60 * 1000; // 1 minute (CMC data update frequency)

let cachedQuotes: { data: Record<string, any>; key?: string; at: number } | null = null;
let cachedGlobal: { data: any; at: number } | null = null;
let cachedTrending: { data: any; at: number } | null = null;

async function getCachedOrFetch<T>(
  memCache: { data: T; at: number; key?: string | undefined } | null,
  setMemCache: (v: { data: T; at: number; key?: string | undefined }) => void,
  storageKey: string,
  fetchData: () => Promise<T>,
  cacheKey?: string,
): Promise<{ data: T; cache: { data: T; at: number; key?: string | undefined } }> {
  const now = Date.now();
  if (memCache && now - memCache.at < CMC_CACHE_TTL_MS && (!cacheKey || memCache.key === cacheKey)) {
    return { data: memCache.data, cache: memCache };
  }
  if (!memCache) {
    const stored = await getJSON<{ data: T; at: number; key?: string }>(storageKey);
    if (stored && now - stored.at < CMC_CACHE_TTL_MS && (!cacheKey || stored.key === cacheKey)) {
      setMemCache(stored);
      return { data: stored.data, cache: stored };
    }
  }
  const data = await fetchData();
  const entry = { data, at: now, key: cacheKey };
  setMemCache(entry);
  await setJSON(storageKey, entry);
  return { data, cache: entry };
}

export async function fetchCryptoQuotes(symbols: string[], fetchFn?: FetchFn) {
  if (symbols.length === 0) return {};
  const csv = symbols.join(",");
  const { data } = await getCachedOrFetch(
    cachedQuotes, (v) => { cachedQuotes = v as typeof cachedQuotes; }, "cache-cmc-quotes",
    async () => (await cmcFetch(`/v1/cryptocurrency/quotes/latest?symbol=${csv}&convert=USD`, fetchFn))?.data ?? {},
    csv,
  );
  return data;
}

export async function fetchGlobalMetrics(fetchFn?: FetchFn) {
  const { data } = await getCachedOrFetch(
    cachedGlobal, (v) => { cachedGlobal = v; }, "cache-cmc-global",
    async () => (await cmcFetch(`/v1/global-metrics/quotes/latest`, fetchFn))?.data,
  );
  return data;
}

export async function fetchTrending(fetchFn?: FetchFn) {
  const { data } = await getCachedOrFetch(
    cachedTrending, (v) => { cachedTrending = v; }, "cache-cmc-trending",
    async () => (await cmcFetch(`/v1/cryptocurrency/trending/latest`, fetchFn))?.data,
  );
  return data;
}

export type CMCDeps = {
  fetchFn?: FetchFn;
  getAssets?: () => Promise<CryptoAsset[]>;
};

export async function fetchAndUpsertCMCData(deps: CMCDeps = {}) {
  const { fetchFn, getAssets } = deps;

  try {
    // 1. Resolve the tradeable symbol set from Alpaca
    const alpacaSymbols = await getAlpacaSymbolSet(getAssets);
    if (alpacaSymbols.size === 0) {
      log.warn("No tradeable Alpaca crypto assets found — skipping CMC fetch");
      return;
    }
    const symbolList = [...alpacaSymbols];
    log.info(`Alpaca tradeable crypto symbols (${symbolList.length}): ${symbolList.join(", ")}`);

    // 2. Fetch CMC data — quotes for Alpaca symbols, plus global metrics & trending
    const [quotes, global, trending] = await Promise.all([
      fetchCryptoQuotes(symbolList, fetchFn).catch((e) => { log.error(`CMC quotes failed: ${e.message}`); return {} as Record<string, any>; }),
      fetchGlobalMetrics(fetchFn).catch((e) => { log.error(`CMC global metrics failed: ${e.message}`); return null; }),
      fetchTrending(fetchFn).catch((e) => { log.error(`CMC trending failed: ${e.message}`); return null; }),
    ]);

    // 3. Upsert per-symbol quotes into market-data lane
    for (const sym of symbolList) {
      const quote = quotes[sym];
      const q = quote?.quote?.USD;
      if (!q) continue;

      const priceStr = q.price >= 1 ? q.price.toFixed(2) : q.price.toPrecision(4);
      traderContext.upsertEvidence({
        id: `cmc-quote-${sym}`,
        summary: `${sym} $${priceStr} | 1h:${q.percent_change_1h?.toFixed(2)}% 24h:${q.percent_change_24h?.toFixed(2)}% 7d:${q.percent_change_7d?.toFixed(2)}%`,
        detail: JSON.stringify({
          price: q.price,
          volume_24h: q.volume_24h,
          market_cap: q.market_cap,
          percent_change_1h: q.percent_change_1h,
          percent_change_24h: q.percent_change_24h,
          percent_change_7d: q.percent_change_7d,
          percent_change_30d: q.percent_change_30d,
        }),
        severity: "medium",
        confidence: "high",
        tags: [
          { key: "lane", value: "market-data" },
          { key: "ticker", value: `${sym}/USD` },
          { key: "source", value: "coinmarketcap" },
        ],
        provenance: { source: "web", createdAt: new Date().toISOString() },
      });
      log.info(`UPSERT CMC quote: ${sym} @ $${priceStr}`);
    }

    // 4. Upsert global metrics into risk-factors lane
    if (global) {
      const gq = global.quote?.USD;
      traderContext.upsertEvidence({
        id: "cmc-global-metrics",
        summary: `Global: MCap $${(gq?.total_market_cap / 1e12)?.toFixed(2)}T | BTC dom ${global.btc_dominance?.toFixed(1)}% | ETH dom ${global.eth_dominance?.toFixed(1)}%`,
        detail: JSON.stringify({
          total_market_cap: gq?.total_market_cap,
          btc_dominance: global.btc_dominance,
          eth_dominance: global.eth_dominance,
          active_cryptocurrencies: global.active_cryptocurrencies,
        }),
        severity: "low",
        confidence: "high",
        tags: [
          { key: "lane", value: "risk-factors" },
          { key: "source", value: "coinmarketcap" },
        ],
        provenance: { source: "web", createdAt: new Date().toISOString() },
      });
      log.info(`UPSERT CMC global metrics: BTC dom ${global.btc_dominance?.toFixed(1)}%`);
    }

    // 5. Upsert trending — only coins that are also on Alpaca
    if (trending && Array.isArray(trending)) {
      const alpacaTrending = trending.filter((c: any) => alpacaSymbols.has(c.symbol));
      const top = alpacaTrending.slice(0, 10);
      if (top.length > 0) {
        traderContext.upsertEvidence({
          id: "cmc-trending",
          summary: `Trending (Alpaca-tradeable): ${top.map((c: any) => c.symbol ?? c.name).join(", ")}`,
          detail: JSON.stringify(top.map((c: any) => ({
            name: c.name,
            symbol: c.symbol,
            slug: c.slug,
          }))),
          severity: "low",
          confidence: "medium",
          tags: [
            { key: "lane", value: "market-events" },
            { key: "source", value: "coinmarketcap" },
          ],
          provenance: { source: "web", createdAt: new Date().toISOString() },
        });
        log.info(`UPSERT CMC trending: ${top.length} Alpaca-tradeable coins`);
      }
    }

    log.info("CMC data ingest done");
  } catch (err) {
    log.error(`CMC fetch failed: ${(err as Error).message}`);
  }
}
