import type { Decision } from "./decision.ts";
import { getCryptoPositions, placeCryptoMarketBuy, placeCryptoMarketSell } from "./alpaca.ts";
import type { CryptoPosition } from "./alpaca.ts";
import { config } from "./config.ts";
import { dayKeyET } from "./time.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import { getJSON, setJSON, appendTradeLog, recordBuyEntry, recordSellExit } from "./storage.ts";

export type TradingState = {
  lastTradeAt: number;
  tradesToday: number;
  tradeDayKey: string;
  circuitBreakerTripped: boolean;
};

export function createTradingState(): TradingState {
  return { lastTradeAt: 0, tradesToday: 0, tradeDayKey: "", circuitBreakerTripped: false };
}

export async function loadTradingState(): Promise<TradingState> {
  const stored = await getJSON<TradingState>("trading-state");
  return stored ?? createTradingState();
}

export async function saveTradingState(state: TradingState): Promise<void> {
  await setJSON("trading-state", state);
}

export type TradingDeps = {
  getCryptoPositions?: () => Promise<CryptoPosition[]>;
  placeCryptoMarketBuy?: (symbol: string, notional: number) => Promise<any>;
  placeCryptoMarketSell?: (symbol: string, qty: number) => Promise<any>;
  now?: () => number;
  logger?: Logger;
};

const defaultDeps: Required<TradingDeps> = {
  getCryptoPositions: () => getCryptoPositions(),
  placeCryptoMarketBuy: (symbol, notional) => placeCryptoMarketBuy(symbol, notional),
  placeCryptoMarketSell: (symbol, qty) => placeCryptoMarketSell(symbol, qty),
  now: () => Date.now(),
  logger: createLogger("crypto-trading"),
};

export type TradeResult =
  | { status: "circuit_breaker" }
  | { status: "cooldown" }
  | { status: "daily_limit" }
  | { status: "low_confidence"; confidence: number }
  | { status: "hold" }
  | { status: "max_position"; positionValue: number }
  | { status: "sell_completed"; qty: number }
  | { status: "sell_none" }
  | { status: "buy_placed"; notional: number; orderId?: string }
  | { status: "order_error"; message: string };

function resetDailyCountersIfNeeded(state: TradingState, now: () => number) {
  const k = dayKeyET(new Date(now()));
  if (k !== state.tradeDayKey) {
    state.tradeDayKey = k;
    state.tradesToday = 0;
  }
}

export async function executeDecision(
  decision: Decision,
  deps: TradingDeps = {},
  state: TradingState = createTradingState(),
): Promise<TradeResult> {
  const { getCryptoPositions, placeCryptoMarketBuy, placeCryptoMarketSell, now, logger } = {
    ...defaultDeps,
    ...deps,
  };

  resetDailyCountersIfNeeded(state, now);

  if (state.circuitBreakerTripped) {
    logger.warn(`[TRADE] Blocked: circuit breaker is tripped`);
    return { status: "circuit_breaker" };
  }

  const current = now();
  if (current - state.lastTradeAt < config.COOLDOWN_MS) {
    logger.info(`[TRADE] Skipped: cooldown active (${config.COOLDOWN_MS - (current - state.lastTradeAt)}ms remaining)`);
    return { status: "cooldown" };
  }

  if (state.tradesToday >= config.MAX_TRADES_PER_DAY) {
    logger.info(`[TRADE] Skipped: daily trade limit reached`);
    return { status: "daily_limit" };
  }

  if (decision.confidence < config.MIN_CONFIDENCE) {
    logger.info(`[TRADE] Skipped: low confidence ${decision.confidence}`);
    return { status: "low_confidence", confidence: decision.confidence };
  }

  if (decision.action === "hold") return { status: "hold" };

  const positions = await getCryptoPositions();
  const positionValue = positions.reduce((sum, p) => sum + Math.abs(Number(p.market_value) || 0), 0);
  logger.debug(`[TRADE] Crypto positions=${positions.length}, value=$${positionValue.toFixed(2)}`);

  if (decision.action === "sell") {
    // Only sell positions matching the ticker the LLM recommended selling
    const targetSym = decision.ticker.replace("/", "");
    const matchingPositions = positions.filter((p) => p.symbol.replace("/", "") === targetSym);

    if (matchingPositions.length === 0) {
      logger.info(`[TRADE] Sell requested for ${decision.ticker}, but no matching position found.`);
      return { status: "sell_none" };
    }

    try {
      let totalQty = 0;
      for (const p of matchingPositions) {
        const qty = Math.abs(Number(p.qty) || 0);
        if (qty <= 0) continue;
        const exitValue = Math.abs(Number(p.market_value) || 0);
        const order = await placeCryptoMarketSell(p.symbol, qty);
        totalQty += qty;
        logger.info(`[TRADE] Sold ${qty} of ${p.symbol} (market).`);
        await appendTradeLog({ timestamp: new Date().toISOString(), side: "sell", ticker: p.symbol, qty, notional: exitValue, orderId: order?.id });
        const completed = await recordSellExit(p.symbol, exitValue);
        if (completed) {
          const tag = completed.win ? "WIN" : "LOSS";
          logger.info(`[TRADE] ${tag}: ${completed.ticker} P/L=${completed.pnl >= 0 ? "+" : ""}$${completed.pnl.toFixed(2)} (${completed.pnlPct >= 0 ? "+" : ""}${completed.pnlPct.toFixed(2)}%)`);
        }
      }

      state.tradesToday += 1;
      state.lastTradeAt = now();
      await saveTradingState(state);
      return { status: "sell_completed", qty: totalQty };
    } catch (err) {
      logger.error(`[ERROR] Sell failed: ${(err as Error).message}`);
      state.circuitBreakerTripped = true;
      logger.error(`[SAFETY] Circuit breaker TRIPPED.`);
      await saveTradingState(state);
      return { status: "order_error", message: (err as Error).message };
    }
  }

  // buy
  if (positionValue >= config.MAX_POSITION_SIZE_USD) {
    logger.info(`[TRADE] Skipped: already at/over MAX_POSITION_SIZE_USD ($${positionValue.toFixed(2)}/$${config.MAX_POSITION_SIZE_USD})`);
    return { status: "max_position", positionValue };
  }

  const room = config.MAX_POSITION_SIZE_USD - positionValue;
  const notional = Math.min(decision.size_usd, room);

  if (notional <= 0) {
    logger.info(`[TRADE] Skipped: notional reduced to 0 by risk controls.`);
    return { status: "max_position", positionValue };
  }

  try {
    const ticker = decision.ticker;
    const order = await placeCryptoMarketBuy(ticker, notional);
    state.tradesToday += 1;
    state.lastTradeAt = now();
    await saveTradingState(state);
    await appendTradeLog({ timestamp: new Date().toISOString(), side: "buy", ticker, qty: 0, notional, orderId: order?.id });
    await recordBuyEntry(ticker, notional);

    logger.info(
      `[TRADE] Placed MARKET BUY ${ticker} notional=$${notional.toFixed(2)} orderId=${order?.id ?? "?"}`,
    );

    return { status: "buy_placed", notional, orderId: order?.id };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`[ERROR] Buy order failed: ${msg}`);
    // Don't trip circuit breaker for sizing errors — not an exchange failure
    if (!msg.includes("integer qty required") && !msg.includes("too small")) {
      state.circuitBreakerTripped = true;
      logger.error(`[SAFETY] Circuit breaker TRIPPED.`);
    }
    await saveTradingState(state);
    return { status: "order_error", message: msg };
  }
}
