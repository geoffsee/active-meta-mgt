import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { createLogger } from "./logger.ts";

const log = createLogger("crypto-storage");

const DATA_DIR = ".data/crypto";

export const storage = createStorage({
  driver: fsDriver({ base: DATA_DIR }),
});

// ── Typed helpers ──

export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const val = await storage.getItem<T>(key);
    return val ?? null;
  } catch (e) {
    log.error(`Failed to read ${key}: ${(e as Error).message}`);
    return null;
  }
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  try {
    await storage.setItem(key, value as any);
  } catch (e) {
    log.error(`Failed to write ${key}: ${(e as Error).message}`);
  }
}

// ── Decision audit log ──

export type DecisionLogEntry = {
  timestamp: string;
  action: string;
  ticker: string;
  confidence: number;
  size_usd: number;
  rationale: string;
};

const MAX_DECISION_LOG = 200;

export async function appendDecisionLog(entry: DecisionLogEntry): Promise<void> {
  const raw = await getJSON<DecisionLogEntry[]>("decisions");
  const log = Array.isArray(raw) ? raw : [];
  log.push(entry);
  // Keep only the most recent entries
  if (log.length > MAX_DECISION_LOG) log.splice(0, log.length - MAX_DECISION_LOG);
  await setJSON("decisions", log);
}

export async function getDecisionLog(): Promise<DecisionLogEntry[]> {
  const data = await getJSON<DecisionLogEntry[]>("decisions");
  return Array.isArray(data) ? data : [];
}

// ── Trade history ──

export type TradeLogEntry = {
  timestamp: string;
  side: "buy" | "sell";
  ticker: string;
  qty: number;
  notional: number;
  orderId?: string;
};

const MAX_TRADE_LOG = 500;

export async function appendTradeLog(entry: TradeLogEntry): Promise<void> {
  const raw = await getJSON<TradeLogEntry[]>("trades");
  const trades = Array.isArray(raw) ? raw : [];
  trades.push(entry);
  if (trades.length > MAX_TRADE_LOG) trades.splice(0, trades.length - MAX_TRADE_LOG);
  await setJSON("trades", trades);
}

export async function getTradeLog(): Promise<TradeLogEntry[]> {
  const data = await getJSON<TradeLogEntry[]>("trades");
  return Array.isArray(data) ? data : [];
}

// ── Round-trip trade tracking (win/loss) ──

export type OpenPosition = {
  ticker: string;
  entryTimestamp: string;
  entryNotional: number;
};

export type CompletedTrade = {
  ticker: string;
  entryTimestamp: string;
  exitTimestamp: string;
  entryNotional: number;
  exitNotional: number;
  pnl: number;
  pnlPct: number;
  win: boolean;
};

const MAX_COMPLETED = 500;

export async function getOpenPositions(): Promise<OpenPosition[]> {
  const data = await getJSON<OpenPosition[]>("positions-open");
  return Array.isArray(data) ? data : [];
}

export async function recordBuyEntry(ticker: string, notional: number): Promise<void> {
  const positions = await getOpenPositions();
  // Accumulate if already holding
  const existing = positions.find((p) => p.ticker === ticker);
  if (existing) {
    existing.entryNotional += notional;
  } else {
    positions.push({ ticker, entryTimestamp: new Date().toISOString(), entryNotional: notional });
  }
  await setJSON("positions-open", positions);
}

export async function recordSellExit(ticker: string, exitNotional: number): Promise<CompletedTrade | null> {
  const positions = await getOpenPositions();
  const normalized = ticker.replace("/", "");
  const idx = positions.findIndex((p) => p.ticker.replace("/", "") === normalized);
  if (idx === -1) return null;

  const entry = positions[idx]!;
  const pnl = exitNotional - entry.entryNotional;
  const pnlPct = entry.entryNotional > 0 ? (pnl / entry.entryNotional) * 100 : 0;

  const completed: CompletedTrade = {
    ticker: entry.ticker,
    entryTimestamp: entry.entryTimestamp,
    exitTimestamp: new Date().toISOString(),
    entryNotional: entry.entryNotional,
    exitNotional,
    pnl,
    pnlPct,
    win: pnl > 0,
  };

  // Remove from open
  positions.splice(idx, 1);
  await setJSON("positions-open", positions);

  // Append to completed
  const raw = await getJSON<CompletedTrade[]>("trades-completed");
  const history = Array.isArray(raw) ? raw : [];
  history.push(completed);
  if (history.length > MAX_COMPLETED) history.splice(0, history.length - MAX_COMPLETED);
  await setJSON("trades-completed", history);

  return completed;
}

export async function getCompletedTrades(): Promise<CompletedTrade[]> {
  const data = await getJSON<CompletedTrade[]>("trades-completed");
  return Array.isArray(data) ? data : [];
}

// ── Portfolio snapshots ──

export type PortfolioSnapshot = {
  timestamp: string;
  equity: number;
  cash: number;
  positionValue: number;
  positions: { symbol: string; qty: string; market_value: string; unrealized_pl: string }[];
};

export async function getStartingEquity(): Promise<number | null> {
  return await getJSON<number>("portfolio-starting-equity");
}

export async function setStartingEquity(equity: number): Promise<void> {
  await setJSON("portfolio-starting-equity", equity);
}

export async function appendPortfolioSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
  const snapshots = await getJSON<PortfolioSnapshot[]>("portfolio-snapshots") ?? [];
  snapshots.push(snapshot);
  // Keep last 500 snapshots
  if (snapshots.length > 500) snapshots.splice(0, snapshots.length - 500);
  await setJSON("portfolio-snapshots", snapshots);
}
