import OpenAI from "openai";
import { Configuration, V1Api } from "@goperigon/perigon-ts";
import { makeDefaultActiveMetaContext } from "active-meta-mgt";
import { config, keys } from "./config.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("crypto-clients");

export const openai = new OpenAI({ apiKey: keys.OPENAI_API_KEY });

export const perigon = new V1Api(new Configuration({
  apiKey: keys.PERIGON_API_KEY,
}));

export const traderContext = makeDefaultActiveMetaContext("trader-crypto-multi");
traderContext.ensureLane("news-sentiment", "Real-Time Crypto News & Sentiment");
traderContext.ensureLane("market-events", "Clustered Crypto Stories & Trends");
traderContext.ensureLane("market-data", "CoinMarketCap Market Data");
traderContext.ensureLane("risk-factors", "Risk Alerts & Regulatory Events");
traderContext.ensureLane("strategy", "Crypto Trading Goals & Constraints");

traderContext.upsertGoal({
  id: "goal-main",
  title: "Maximize profit by actively trading crypto spot positions across all available symbols",
  priority: "p0",
  tags: [{ key: "lane", value: "strategy" }],
});

traderContext.upsertGoal({
  id: "goal-deploy-capital",
  title: "Always have capital deployed — find the best opportunity and enter a position. Holding cash is losing to inflation.",
  priority: "p0",
  tags: [{ key: "lane", value: "strategy" }],
});

traderContext.upsertConstraint({
  id: "con-risk",
  statement: [
    "Spot buy/sell only (no leverage, no derivatives).",
    `Max position size=$${config.MAX_POSITION_SIZE_USD}.`,
    `Min confidence=${config.MIN_CONFIDENCE}.`,
    `Max trades/day=${config.MAX_TRADES_PER_DAY}.`,
    `Cooldown=${config.COOLDOWN_MS}ms between trades.`,
  ].join(" "),
  priority: "p0",
  tags: [{ key: "lane", value: "risk-factors" }],
});

traderContext.hooks.on?.("archive:created", (event: any) => {
  log.info(`AUDIT archive created: ${event.archiveId} at ${event.timestamp}`);
});
