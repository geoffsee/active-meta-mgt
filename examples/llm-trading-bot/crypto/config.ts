import dotenv from "dotenv";

dotenv.config();

export const TEST_MODE = process.env.NODE_ENV === "test" || process.env.BUN_TESTING === "1";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v) return v;
  if (TEST_MODE) return `test-${name.toLowerCase()}`;
  throw new Error(`Missing required env var: ${name}`);
}

export const config = {
  CRYPTO_TICKER: process.env.CRYPTO_TICKER ?? "BTC/USD",
  POLL_INTERVAL_MS: Number(process.env.CRYPTO_POLL_INTERVAL_MS ?? 15_000),
  NEWS_LOOKBACK_MS: Number(process.env.CRYPTO_NEWS_LOOKBACK_MS ?? 2 * Number(process.env.CRYPTO_POLL_INTERVAL_MS ?? 15_000)),
  ARTICLES_PAGE_SIZE: Number(process.env.CRYPTO_ARTICLES_PAGE_SIZE ?? 8),
  STORIES_PAGE_SIZE: Number(process.env.CRYPTO_STORIES_PAGE_SIZE ?? 5),
  TOKEN_BUDGET: Number(process.env.CRYPTO_TOKEN_BUDGET ?? 1500),
  LLM_MODEL: process.env.LLM_MODEL ?? "gpt-4o",
  ONLY_TRADE_RTH: false,
  MIN_CONFIDENCE: Number(process.env.CRYPTO_MIN_CONFIDENCE ?? 0.75),
  COOLDOWN_MS: Number(process.env.CRYPTO_COOLDOWN_MS ?? 60_000),
  MAX_TRADES_PER_DAY: Number(process.env.CRYPTO_MAX_TRADES_PER_DAY ?? 50),
  MAX_POSITION_SIZE_USD: Number(process.env.CRYPTO_MAX_POSITION_SIZE_USD ?? 5000),
  PAPER: (process.env.ALPACA_PAPER ?? "true") === "true",
  LOG_DECISIONS: (process.env.LOG_DECISIONS ?? "true") === "true",
} as const;

export const keys = {
  OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
  PERIGON_API_KEY: requireEnv("PERIGON_API_KEY"),
  APCA_KEY: requireEnv("ALPACA_API_KEY"),
  APCA_SECRET: requireEnv("ALPACA_API_SECRET"),
  CCC_API_KEY: requireEnv("CCC_API_KEY"),
} as const;

export const ALPACA_TRADING_BASE = config.PAPER ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
export const ALPACA_CRYPTO_DATA_BASE = "https://data.alpaca.markets";

export type Config = typeof config;
