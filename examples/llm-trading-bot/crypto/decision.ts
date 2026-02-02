import { openai, traderContext } from "./clients.ts";
import { config } from "./config.ts";
import { getCryptoQuote, getCryptoPositions } from "./alpaca.ts";
import type { CryptoPosition, CryptoQuote } from "./alpaca.ts";
import { getAlpacaSymbolSet } from "./coinmarketcap.ts";
import { createLogger } from "./logger.ts";
import { appendDecisionLog, getCompletedTrades, getTradeLog } from "./storage.ts";

export type Decision = {
  action: "buy" | "sell" | "hold";
  ticker: string;
  size_usd: number;
  confidence: number;
  rationale: string;
};

export function isValidDecision(d: any): d is Decision {
  if (!d || typeof d !== "object") return false;
  if (!["buy", "sell", "hold"].includes(d.action)) return false;
  if (!Number.isFinite(d.size_usd)) return false;
  if (!Number.isFinite(d.confidence)) return false;
  if (typeof d.rationale !== "string") return false;
  if (typeof d.ticker !== "string" || d.ticker.length === 0) return false;
  return true;
}

export type DecisionDeps = {
  context?: any;
  openaiClient?: any;
  getCryptoQuoteFn?: () => Promise<CryptoQuote | null>;
  getCryptoPositionsFn?: () => Promise<CryptoPosition[]>;
  getAlpacaSymbolsFn?: () => Promise<Set<string>>;
  logger?: (msg: string) => void;
};

const defaultDeps: Required<DecisionDeps> = {
  context: traderContext,
  openaiClient: openai,
  getCryptoQuoteFn: () => getCryptoQuote(),
  getCryptoPositionsFn: () => getCryptoPositions(),
  getAlpacaSymbolsFn: () => getAlpacaSymbolSet(),
  logger: createLogger("crypto-decision").info,
};

export async function synthesizeAndDecide(deps: DecisionDeps = {}): Promise<Decision | null> {
  const { context, openaiClient, getCryptoQuoteFn, getCryptoPositionsFn, getAlpacaSymbolsFn, logger } = {
    ...defaultDeps,
    ...deps,
  };

  try {
    logger(`Synthesizing context with tokenBudget=${config.TOKEN_BUDGET}`);
    await context.synthesizeFromLanes({ tokenBudget: config.TOKEN_BUDGET, archiveRawItems: true });
    const payload = context.buildLLMContextPayload();
    const contextText = payload.workingMemory.text;

    const quote = await getCryptoQuoteFn();
    logger(`Fetched crypto quote mid=${quote?.mid ?? "unknown"}`);
    const positions = await getCryptoPositionsFn();
    const positionValue = positions.reduce((sum, p) => sum + Math.abs(Number(p.market_value) || 0), 0);
    logger(`Open crypto positions=${positions.length}, value=$${positionValue.toFixed(2)}`);

    // Fetch recent trade history for LLM context
    const completedTrades = await getCompletedTrades();
    const recentTrades = completedTrades.slice(-10);
    const recentTradeLog = await getTradeLog();
    const recentOrders = recentTradeLog.slice(-10);

    let availableSymbols: string[];
    try {
      const symbolSet = await getAlpacaSymbolsFn();
      availableSymbols = [...symbolSet].sort();
    } catch {
      availableSymbols = [config.CRYPTO_TICKER.replace("/", "").replace("USD", "")];
    }

    const resp = await openaiClient.chat.completions.create({
      model: config.LLM_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are an aggressive crypto spot trading policy engine. Your goal is to MAXIMIZE PROFIT.",
            "Return ONLY valid JSON with exactly these keys:",
            "{action: 'buy'|'sell'|'hold', ticker: string, size_usd: number, confidence: number, rationale: string}.",
            "",
            "MANDATE: You must always be deploying capital. Cash sitting idle is a loss.",
            "- If you have no position: you MUST buy. Pick the best symbol and enter.",
            "- If you have a position that's underperforming: sell it and rotate into something better.",
            "- 'hold' is only acceptable when you already have a position you're confident in.",
            "",
            "Rules:",
            `- ticker must be one of these Alpaca-tradeable symbols: ${availableSymbols.join(", ")}.`,
            `  Use the format '<SYMBOL>/USD' (e.g. 'BTC/USD', 'ETH/USD', ...).`,
            `- confidence in [0,1].`,
            `- size_usd is a non-negative number (USD amount to buy or sell).`,
            `- You may ONLY recommend: buy, sell, or hold.`,
            `- This system only trades spot (no leverage, no derivatives).`,
            `- Size positions based on conviction — high conviction = larger size.`,
            `- Be momentum-driven: follow strong trends, fade weak ones.`,
            `- Be news-driven: react to breaking regulatory, hack, whale, or macro events.`,
            `- If strong bearish signal on your current position: sell and rotate.`,
            `- Pick the symbol with the best risk/reward right now from the available data.`,
            `- IMPORTANT: Orders use integer qty. Do NOT pick assets whose price exceeds $${config.MAX_POSITION_SIZE_USD} (e.g. BTC at $77k) — you cannot buy even 1 unit.`,
            `- LEARN FROM HISTORY: Review your recent trade results. If you keep losing on a symbol, STOP trading it and rotate to something else.`,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Reference asset: ${config.CRYPTO_TICKER}`,
            `Current ${config.CRYPTO_TICKER} mid price: ${quote == null ? "unknown" : `$${quote.mid.toFixed(2)}`}`,
            `Bid: ${quote?.bid?.toFixed(2) ?? "?"} Ask: ${quote?.ask?.toFixed(2) ?? "?"}`,
            `Current total position value: $${positionValue.toFixed(2)}`,
            positions.length > 0
              ? `Open positions: ${positions.map(p => `${p.symbol} qty=${p.qty} val=$${Number(p.market_value).toFixed(2)}`).join(", ")}`
              : "Open positions: NONE — you MUST enter a position now.",
            `Evaluation interval: every ${config.POLL_INTERVAL_MS / 1000}s. Market data refreshes every 60s. TA uses 1Min candles (last 50min). Cooldown between trades: ${config.COOLDOWN_MS / 1000}s. Max trades/day: ${config.MAX_TRADES_PER_DAY}.`,
            `Hard limits: max position size=$${config.MAX_POSITION_SIZE_USD}.`,
            `Available symbols: ${availableSymbols.join(", ")}`,
            "",
            recentOrders.length > 0
              ? `Recent orders (last ${recentOrders.length}):\n${recentOrders.map(o => `  ${o.timestamp.slice(11, 19)} ${o.side.toUpperCase()} ${o.ticker} $${o.notional.toFixed(2)} qty=${o.qty}`).join("\n")}`
              : "Recent orders: NONE",
            "",
            recentTrades.length > 0
              ? (() => {
                  const wins = recentTrades.filter(t => t.win).length;
                  const losses = recentTrades.length - wins;
                  const winRate = ((wins / recentTrades.length) * 100).toFixed(0);
                  const totalPnl = recentTrades.reduce((s, t) => s + t.pnl, 0);
                  return [
                    `Recent round-trip trades (last ${recentTrades.length}): ${wins}W/${losses}L (${winRate}% win rate), net P/L: $${totalPnl.toFixed(2)}`,
                    ...recentTrades.map(t => `  ${t.exitTimestamp.slice(11, 19)} ${t.win ? "WIN" : "LOSS"} ${t.ticker} $${t.pnl.toFixed(2)} (${t.pnlPct.toFixed(2)}%)`),
                    "",
                    "IMPORTANT: Review your recent losses. Do NOT repeat the same losing trade. If a symbol is consistently losing, rotate to a different one.",
                  ].join("\n");
                })()
              : "Recent round-trip trades: NONE — no completed trades yet.",
            "",
            "Context (recent news + market data + clusters):",
            contextText,
          ].join("\n"),
        },
      ],
    });

    const usage = resp.usage;
    if (usage) {
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? 0;
      // Pricing for gpt-4.1-mini: $0.40/1M input, $1.60/1M output
      const costUsd = (promptTokens * 0.40 + completionTokens * 1.60) / 1_000_000;
      logger(`[LLM] Tokens: ${promptTokens} in + ${completionTokens} out = ${totalTokens} total | Cost: $${costUsd.toFixed(4)}`);
    }

    const raw = resp.choices?.[0]?.message?.content ?? "";
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { action: "hold", ticker: config.CRYPTO_TICKER, size_usd: 0, confidence: 1, rationale: "LLM returned invalid JSON." };
    }

    if (!isValidDecision(parsed)) {
      return { action: "hold", ticker: config.CRYPTO_TICKER, size_usd: 0, confidence: 1, rationale: "LLM decision failed validation." };
    }

    const decision: Decision = {
      action: parsed.action,
      ticker: String(parsed.ticker),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
      size_usd: Math.max(0, Math.min(config.MAX_POSITION_SIZE_USD, Number(parsed.size_usd))),
      rationale: String(parsed.rationale ?? "").slice(0, 800),
    };

    if (config.LOG_DECISIONS) {
      const actionColor = decision.action === "buy" ? "\x1b[32m" : decision.action === "sell" ? "\x1b[31m" : "\x1b[33m";
      logger(`${actionColor}\x1b[1m[${decision.action.toUpperCase()}]\x1b[0m ${decision.ticker} $${decision.size_usd.toFixed(2)} conf=${decision.confidence.toFixed(2)} — ${decision.rationale.slice(0, 120)}`);
    }
    await appendDecisionLog({
      timestamp: new Date().toISOString(),
      action: decision.action,
      ticker: decision.ticker,
      confidence: decision.confidence,
      size_usd: decision.size_usd,
      rationale: decision.rationale,
    });
    return decision;
  } catch (err) {
    createLogger("crypto-decision").error(`[ERROR] Synthesis/LLM failed: ${(err as Error).message}`);
    return null;
  }
}
