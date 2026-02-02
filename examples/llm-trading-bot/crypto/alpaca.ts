import { ALPACA_CRYPTO_DATA_BASE, ALPACA_TRADING_BASE, config, keys } from "./config.ts";
import { round2 } from "./time.ts";
import { createLogger } from "./logger.ts";
import { getJSON, setJSON } from "./storage.ts";

const log = createLogger("crypto-alpaca");

export async function alpacaCryptoTradingFetch(path: string, init?: RequestInit) {
  const url = `${ALPACA_TRADING_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": keys.APCA_KEY,
      "APCA-API-SECRET-KEY": keys.APCA_SECRET,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alpaca Trading ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export async function alpacaCryptoDataFetch(path: string, init?: RequestInit) {
  const url = `${ALPACA_CRYPTO_DATA_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": keys.APCA_KEY,
      "APCA-API-SECRET-KEY": keys.APCA_SECRET,
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alpaca Crypto Data ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export type CryptoQuote = { bid: number; ask: number; mid: number };

export type CryptoPosition = { symbol: string; qty: string; asset_class?: string; market_value?: string; current_price?: string };

export async function getCryptoQuote(ticker: string = config.CRYPTO_TICKER): Promise<CryptoQuote | null> {
  try {
    const encoded = encodeURIComponent(ticker.replace("/", "%2F"));
    const data = await alpacaCryptoDataFetch(`/v1beta3/crypto/us/latest/quotes?symbols=${ticker.replace("/", "%2F")}`);
    const q = data?.quotes?.[ticker] ?? data?.quotes?.[ticker.replace("/", "")] ?? data;
    const bid = Number(q?.bp ?? q?.bid_price ?? NaN);
    const ask = Number(q?.ap ?? q?.ask_price ?? NaN);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { bid, ask, mid: round2((bid + ask) / 2) };
  } catch (e) {
    log.error(`Crypto quote fetch failed: ${(e as Error).message}`);
    return null;
  }
}

export type AlpacaAccount = { equity: string; cash: string; portfolio_value: string; buying_power: string };

export async function getAccount(): Promise<AlpacaAccount | null> {
  try {
    return await alpacaCryptoTradingFetch(`/v2/account`);
  } catch {
    return null;
  }
}

export async function getCryptoPositions(): Promise<CryptoPosition[]> {
  try {
    const data = await alpacaCryptoTradingFetch(`/v2/positions`);
    const all: CryptoPosition[] = Array.isArray(data) ? data : [];
    return all.filter((p) => p.asset_class === "crypto");
  } catch {
    return [];
  }
}

export type CryptoAsset = { id: string; symbol: string; name: string; status: string; tradable: boolean; min_trade_increment?: string; min_order_size?: string };

const ASSET_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cachedAssets: CryptoAsset[] | null = null;
let cachedAssetsAt = 0;

export async function getAlpacaCryptoAssets(): Promise<CryptoAsset[]> {
  const now = Date.now();
  if (cachedAssets && now - cachedAssetsAt < ASSET_CACHE_TTL_MS) return cachedAssets;

  // Try disk cache first
  if (!cachedAssets) {
    const stored = await getJSON<{ assets: CryptoAsset[]; at: number }>("cache-alpaca-assets");
    if (stored && now - stored.at < ASSET_CACHE_TTL_MS) {
      cachedAssets = stored.assets;
      cachedAssetsAt = stored.at;
      return cachedAssets;
    }
  }

  try {
    const data = await alpacaCryptoTradingFetch(`/v2/assets?asset_class=crypto&status=active`);
    const all: CryptoAsset[] = Array.isArray(data) ? data : [];
    cachedAssets = all.filter((a) => a.tradable);
    cachedAssetsAt = now;
    await setJSON("cache-alpaca-assets", { assets: cachedAssets, at: now });
    return cachedAssets;
  } catch (e) {
    log.error(`Failed to fetch Alpaca crypto assets: ${(e as Error).message}`);
    if (cachedAssets) return cachedAssets;
    return [];
  }
}

export async function placeCryptoMarketBuy(symbol: string, notional: number) {
  const quote = await getCryptoQuote(symbol);
  if (!quote) throw new Error(`Cannot place buy: no quote available for ${symbol}`);
  // Alpaca paper trading requires integer qty for all crypto
  const qty = Math.floor(notional / quote.ask);
  if (qty <= 0) throw new Error(`Notional $${notional} too small for ${symbol} at ask $${quote.ask} (integer qty required)`);
  const body = {
    symbol: symbol.replace("/", ""),
    qty: String(qty),
    side: "buy",
    type: "market",
    time_in_force: "gtc",
  };
  return alpacaCryptoTradingFetch(`/v2/orders`, { method: "POST", body: JSON.stringify(body) });
}

export async function placeCryptoMarketSell(symbol: string, _qty: number) {
  // Use the close-position endpoint which handles fractional qty on paper trading
  const normalized = symbol.replace("/", "");
  return alpacaCryptoTradingFetch(`/v2/positions/${normalized}`, { method: "DELETE" });
}

export async function placeCryptoLimitBuy(symbol: string, notional: number, limitPrice: number) {
  const qty = round2(notional / limitPrice);
  const body = {
    symbol: symbol.replace("/", ""),
    qty: String(qty),
    side: "buy",
    type: "limit",
    limit_price: String(round2(limitPrice)),
    time_in_force: "gtc",
  };
  return alpacaCryptoTradingFetch(`/v2/orders`, { method: "POST", body: JSON.stringify(body) });
}

export async function placeCryptoLimitSell(symbol: string, qty: number, limitPrice: number) {
  const body = {
    symbol: symbol.replace("/", ""),
    qty: String(qty),
    side: "sell",
    type: "limit",
    limit_price: String(round2(limitPrice)),
    time_in_force: "gtc",
  };
  return alpacaCryptoTradingFetch(`/v2/orders`, { method: "POST", body: JSON.stringify(body) });
}
