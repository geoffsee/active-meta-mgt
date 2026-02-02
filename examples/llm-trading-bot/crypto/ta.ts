import { alpacaCryptoDataFetch } from "./alpaca.ts";
import { getAlpacaSymbolSet } from "./coinmarketcap.ts";
import { traderContext } from "./clients.ts";
import { createLogger } from "./logger.ts";
import { getJSON, setJSON } from "./storage.ts";

const log = createLogger("crypto-ta");

type Bar = { t: string; c: number; h: number; l: number; o: number; v: number };

const BARS_CACHE_TTL_MS = 60 * 1000; // 1 minute
let cachedBars: { data: Map<string, Bar[]>; at: number } | null = null;

export async function fetchBars(symbol: string, limit = 50): Promise<Bar[]> {
  const pair = symbol.includes("/") ? symbol : `${symbol}/USD`;
  const encoded = pair.replace("/", "%2F");
  const data = await alpacaCryptoDataFetch(
    `/v1beta3/crypto/us/bars?symbols=${encoded}&timeframe=1Min&limit=${limit}&sort=asc`,
  );
  const bars: any[] = data?.bars?.[pair] ?? data?.bars?.[pair.replace("/", "")] ?? [];
  return bars.map((b: any) => ({ t: b.t, c: Number(b.c), h: Number(b.h), l: Number(b.l), o: Number(b.o), v: Number(b.v) }));
}

// ── Indicators ──

export function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta > 0) gainSum += delta;
    else lossSum -= delta;
  }
  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i]! * k + ema[i - 1]! * (1 - k));
  }
  return ema;
}

export type MACDResult = { macd: number; signal: number; histogram: number } | null;

export function computeMACD(closes: number[], fast = 12, slow = 26, sig = 9): MACDResult {
  if (closes.length < slow + sig) return null;
  const emaFast = computeEMA(closes, fast);
  const emaSlow = computeEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]!);
  const signalLine = computeEMA(macdLine.slice(slow - 1), sig);
  const macd = macdLine[macdLine.length - 1]!;
  const signal = signalLine[signalLine.length - 1]!;
  return { macd, signal, histogram: macd - signal };
}

export type TASignal = {
  symbol: string;
  rsi: number | null;
  macd: MACDResult;
  summary: string;
};

function summarize(symbol: string, rsi: number | null, macd: MACDResult): string {
  const parts: string[] = [`${symbol}:`];
  if (rsi !== null) {
    const rsiVal = rsi.toFixed(1);
    if (rsi < 30) parts.push(`RSI ${rsiVal} (oversold)`);
    else if (rsi > 70) parts.push(`RSI ${rsiVal} (overbought)`);
    else parts.push(`RSI ${rsiVal}`);
  }
  if (macd) {
    const dir = macd.histogram > 0 ? "bullish" : "bearish";
    const cross = Math.abs(macd.macd - macd.signal) < Math.abs(macd.macd) * 0.05 ? " near crossover" : "";
    parts.push(`MACD ${dir}${cross} (hist ${macd.histogram > 0 ? "+" : ""}${macd.histogram.toFixed(2)})`);
  }
  return parts.join(" | ");
}

export async function computeTAForSymbol(symbol: string, bars: Bar[]): Promise<TASignal> {
  const closes = bars.map((b) => b.c);
  const rsi = computeRSI(closes);
  const macd = computeMACD(closes);
  return { symbol, rsi, macd, summary: summarize(symbol, rsi, macd) };
}

export type TADeps = {
  getSymbols?: () => Promise<Set<string>>;
  fetchBarsFn?: (symbol: string) => Promise<Bar[]>;
};

export async function fetchAndUpsertTA(deps: TADeps = {}): Promise<void> {
  const getSymbols = deps.getSymbols ?? (() => getAlpacaSymbolSet());
  const fetchBarsFn = deps.fetchBarsFn ?? fetchBars;

  try {
    const symbols = await getSymbols();
    if (symbols.size === 0) return;

    const now = Date.now();
    let barsMap: Map<string, Bar[]>;

    if (cachedBars && now - cachedBars.at < BARS_CACHE_TTL_MS) {
      barsMap = cachedBars.data;
    } else {
      // Try disk cache
      const stored = await getJSON<{ entries: [string, Bar[]][]; at: number }>("cache-ta-bars");
      if (stored && now - stored.at < BARS_CACHE_TTL_MS) {
        barsMap = new Map(stored.entries);
        cachedBars = { data: barsMap, at: stored.at };
      } else {
        barsMap = new Map();
        const symbolList = [...symbols];
        const results = await Promise.allSettled(
          symbolList.map(async (sym) => ({ sym, bars: await fetchBarsFn(sym) })),
        );
        for (const r of results) {
          if (r.status === "fulfilled") barsMap.set(r.value.sym, r.value.bars);
        }
        cachedBars = { data: barsMap, at: now };
        await setJSON("cache-ta-bars", { entries: [...barsMap.entries()], at: now });
      }
    }

    const signals: TASignal[] = [];
    for (const [sym, bars] of barsMap) {
      if (bars.length < 2) continue;
      signals.push(await computeTAForSymbol(sym, bars));
    }

    if (signals.length === 0) return;

    const allSummaries = signals.map((s) => s.summary).join("\n");
    traderContext.upsertEvidence({
      id: "ta-indicators",
      summary: `Technical Analysis (1Min bars, last 50min):\n${allSummaries}`,
      detail: JSON.stringify(signals.map((s) => ({
        symbol: s.symbol,
        rsi: s.rsi !== null ? Number(s.rsi.toFixed(2)) : null,
        macd: s.macd ? { macd: Number(s.macd.macd.toFixed(4)), signal: Number(s.macd.signal.toFixed(4)), histogram: Number(s.macd.histogram.toFixed(4)) } : null,
      }))),
      severity: "medium",
      confidence: "high",
      tags: [
        { key: "lane", value: "market-data" },
        { key: "source", value: "technical-analysis" },
      ],
      provenance: { source: "inference", createdAt: new Date().toISOString() },
    });
    log.info(`UPSERT TA for ${signals.length} symbols`);
  } catch (err) {
    log.error(`TA compute failed: ${(err as Error).message}`);
  }
}
