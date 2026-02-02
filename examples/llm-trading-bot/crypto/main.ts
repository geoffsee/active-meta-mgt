import { fetchAndUpsertNews } from "./news.ts";
import { fetchAndUpsertCMCData } from "./coinmarketcap.ts";
import { fetchAndUpsertTA } from "./ta.ts";
import { synthesizeAndDecide } from "./decision.ts";
import type { Decision } from "./decision.ts";
import { executeDecision, createTradingState, loadTradingState } from "./trading.ts";
import type { TradingState } from "./trading.ts";
import { getAccount, getCryptoPositions } from "./alpaca.ts";
import { getStartingEquity, setStartingEquity, appendPortfolioSnapshot, getTradeLog, getCompletedTrades } from "./storage.ts";
import { config } from "./config.ts";
import { sleep, dayKeyET } from "./time.ts";
import { createLogger, colors as c } from "./logger.ts";

const log = createLogger("crypto-main");

type MainDeps = {
  fetchNews: () => Promise<void>;
  fetchCMCData: () => Promise<void>;
  fetchTA: () => Promise<void>;
  decide: () => Promise<Decision | null>;
  execute: (decision: Decision, state: TradingState) => Promise<any>;
  reportPerformance: () => Promise<void>;
  sleepFn: (ms: number) => Promise<any>;
  logger: (msg: string) => void;
};

async function reportPerformance() {
  try {
    const [account, positions] = await Promise.all([getAccount(), getCryptoPositions()]);
    if (!account) return;

    const equity = Number(account.equity);
    const cash = Number(account.cash);
    const positionValue = positions.reduce((s, p) => s + Math.abs(Number(p.market_value) || 0), 0);
    const unrealizedPL = positions.reduce((s, p) => s + (Number((p as any).unrealized_pl) || 0), 0);

    // Track starting equity
    let startEquity = await getStartingEquity();
    if (startEquity === null) {
      startEquity = equity;
      await setStartingEquity(equity);
    }

    const totalReturn = equity - startEquity;
    const totalReturnPct = startEquity > 0 ? (totalReturn / startEquity) * 100 : 0;

    const plColor = (v: number) => v >= 0 ? c.green : c.red;

    const posLines = positions.map((p) => {
      const pl = Number((p as any).unrealized_pl) || 0;
      const plPct = Number((p as any).unrealized_plpc) || 0;
      const plStr = `${pl >= 0 ? "+" : ""}$${pl.toFixed(2)} (${(plPct * 100).toFixed(2)}%)`;
      return `  ${c.bold}${p.symbol}${c.reset}: qty=${p.qty} val=$${Number(p.market_value).toFixed(2)} P/L=${plColor(pl)}${plStr}${c.reset}`;
    });

    const trades = await getTradeLog();
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayTrades = trades.filter((t) => t.timestamp.startsWith(todayKey));
    const totalTrades = trades.length;
    const buys = trades.filter((t) => t.side === "buy").length;
    const sells = trades.filter((t) => t.side === "sell").length;
    const recentTrades = trades.slice(-3).map((t) =>
      `  ${t.timestamp.slice(11, 19)} ${t.side.toUpperCase()} ${t.ticker}${t.notional > 0 ? ` $${t.notional.toFixed(2)}` : ""}${t.qty > 0 ? ` qty=${t.qty}` : ""}`,
    );

    // Win/loss stats
    const completed = await getCompletedTrades();
    const wins = completed.filter((t) => t.win);
    const losses = completed.filter((t) => !t.win);
    const winRate = completed.length > 0 ? (wins.length / completed.length) * 100 : 0;
    const totalRealizedPnl = completed.reduce((s, t) => s + t.pnl, 0);
    const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
    const recentCompleted = completed.slice(-3).map((t) => {
      const tag = t.win ? `${c.bgGreen}${c.bold} WIN ${c.reset}` : `${c.bgRed}${c.bold} LOSS ${c.reset}`;
      const pnlStr = `${plColor(t.pnl)}${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)} (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%)${c.reset}`;
      return `  ${t.exitTimestamp.slice(11, 19)} ${tag} ${t.ticker} ${pnlStr}`;
    });

    const hr = `${c.dim}${"─".repeat(60)}${c.reset}`;
    const returnColor = plColor(totalReturn);
    const unrealizedColor = plColor(unrealizedPL);
    const realizedColor = plColor(totalRealizedPnl);

    log.info([
      "",
      hr,
      `${c.bold}${c.white}  📊 PORTFOLIO REPORT${c.reset}`,
      hr,
      `  ${c.bold}Equity${c.reset}     $${equity.toFixed(2)}  │  ${c.bold}Cash${c.reset}  $${cash.toFixed(2)}  │  ${c.bold}Positions${c.reset}  $${positionValue.toFixed(2)}`,
      `  ${c.bold}Unrealized${c.reset} ${unrealizedColor}${unrealizedPL >= 0 ? "+" : ""}$${unrealizedPL.toFixed(2)}${c.reset}  │  ${c.bold}Total Return${c.reset}  ${returnColor}${totalReturn >= 0 ? "+" : ""}$${totalReturn.toFixed(2)} (${totalReturnPct >= 0 ? "+" : ""}${totalReturnPct.toFixed(3)}%)${c.reset}`,
      hr,
      `  ${c.bold}Trades${c.reset}  ${totalTrades} total (${c.green}${buys} buys${c.reset}, ${c.red}${sells} sells${c.reset}) │ Today: ${todayTrades.length}`,
      `  ${c.bold}W/L${c.reset}     ${c.green}${wins.length}W${c.reset}/${c.red}${losses.length}L${c.reset} (${winRate >= 50 ? c.green : c.red}${winRate.toFixed(1)}%${c.reset}) │ Realized: ${realizedColor}${totalRealizedPnl >= 0 ? "+" : ""}$${totalRealizedPnl.toFixed(2)}${c.reset}`,
      `  ${c.bold}Avg Win${c.reset} ${c.green}+${avgWinPct.toFixed(2)}%${c.reset}  │  ${c.bold}Avg Loss${c.reset} ${c.red}${avgLossPct.toFixed(2)}%${c.reset}`,
      hr,
      ...(posLines.length > 0 ? [`  ${c.bold}Open Positions:${c.reset}`, ...posLines] : [`  ${c.dim}No open positions${c.reset}`]),
      ...(recentTrades.length > 0 ? [`  ${c.bold}Recent Orders:${c.reset}`, ...recentTrades] : []),
      ...(recentCompleted.length > 0 ? [`  ${c.bold}Recent Round-Trips:${c.reset}`, ...recentCompleted] : []),
      hr,
      "",
    ].join("\n"));

    await appendPortfolioSnapshot({
      timestamp: new Date().toISOString(),
      equity,
      cash,
      positionValue,
      positions: positions.map((p) => ({
        symbol: p.symbol,
        qty: p.qty,
        market_value: p.market_value ?? "0",
        unrealized_pl: (p as any).unrealized_pl ?? "0",
      })),
    });
  } catch (e) {
    log.error(`[PORTFOLIO] Failed: ${(e as Error).message}`);
  }
}

const defaultDeps: MainDeps = {
  fetchNews: () => fetchAndUpsertNews(),
  fetchCMCData: () => fetchAndUpsertCMCData(),
  fetchTA: () => fetchAndUpsertTA(),
  decide: () => synthesizeAndDecide(),
  execute: (decision, state) => executeDecision(decision, {}, state),
  reportPerformance: () => reportPerformance(),
  sleepFn: (ms) => sleep(ms),
  logger: (msg) => log.info(msg),
};

export async function runOnce(deps: Partial<MainDeps> = {}, state: TradingState = createTradingState()) {
  const merged = { ...defaultDeps, ...deps };
  merged.logger(`Loop tick: fetching crypto news, market data & TA`);
  await Promise.all([merged.fetchNews(), merged.fetchCMCData(), merged.fetchTA()]);

  merged.logger(`Loop tick: synthesizing decision`);
  const decision = await merged.decide();

  if (decision) {
    merged.logger(`Loop tick: executing decision ${decision.action} (conf=${decision.confidence}, size=$${decision.size_usd})`);
    await merged.execute(decision, state);
  } else {
    merged.logger(`Loop tick: no decision returned (hold implied)`);
  }

  await merged.reportPerformance();
}

export async function mainLoop(deps: Partial<MainDeps> = {}) {
  const merged = { ...defaultDeps, ...deps };

  merged.logger(
    `[START] ${config.PAPER ? "PAPER" : "LIVE"} multi-symbol crypto spot trading. ` +
    `Poll=${config.POLL_INTERVAL_MS / 1000}s, 24/7`,
  );

  const state = await loadTradingState();
  state.tradeDayKey = dayKeyET();

  while (true) {
    await runOnce(merged, state);
    merged.logger(`Sleeping ${config.POLL_INTERVAL_MS / 1000}s until next poll`);
    await merged.sleepFn(config.POLL_INTERVAL_MS);
  }
}
