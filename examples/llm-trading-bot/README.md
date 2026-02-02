# LLM Trading Bot

A high-frequency LLM-powered spot trading bot that runs 24/7 on the Alpaca API. It autonomously makes buy/sell decisions by synthesizing real-time news, market data, and technical analysis into an active meta-context that feeds a decision engine.

## The Role of Active Meta-Context

This example demonstrates how `active-meta-mgt` solves a core problem in LLM-driven systems: **how do you feed an LLM the right information, at the right priority, within a fixed token budget?**

A trading bot ingests a firehose of data every cycle — news articles, story clusters, market quotes, technical indicators, risk alerts, and strategic goals. Dumping all of it into an LLM prompt would blow past token limits and dilute signal with noise. The Active Meta-Context framework acts as the structured intermediary:

### 1. Knowledge Objects as a Unified Data Model

Every piece of incoming data — a Perigon news article, a CoinMarketCap quote, an RSI reading — is upserted as an **Evidence** knowledge object with severity, confidence, and tags. Goals and constraints (e.g., "maximize profit", "max position size $5000") are stored alongside them. This gives the LLM a single, scored data model instead of ad-hoc string concatenation.

```typescript
// news.ts — each article becomes a scored Evidence object
traderContext.upsertEvidence({
  id: stableId,
  summary: `${article.title}: ${article.description}`,
  severity: "medium",
  confidence: "high",
  tags: [{ key: "lane", value: "news-sentiment" }],
  provenance: { source: "web", timestamp: pubDate },
});
```

### 2. Context Lanes for Domain Separation

The bot creates 5 lanes, each with its own selection policy and tag filter:

| Lane | What it contains | Why it's separate |
|---|---|---|
| `news-sentiment` | Real-time articles from Perigon | High volume, short-lived signals |
| `market-events` | Clustered story threads | Broader narrative trends |
| `market-data` | CMC quotes, RSI, MACD, EMA | Quantitative, frequently updated |
| `risk-factors` | Risk constraints, regulatory alerts | Must always surface regardless of recency |
| `strategy` | Trading goals and rules | Persistent, high-priority anchors |

Each lane independently scores and ranks its candidates using configurable weights (`wSeverity`, `wConfidence`, `wPriority`, `wRecency`, `wPinnedBoost`). This prevents a flood of news articles from crowding out critical risk constraints or strategy goals.

### 3. Token-Budgeted Synthesis

Before calling the LLM, the bot runs:

```typescript
await context.synthesizeFromLanes({ tokenBudget: 1500, archiveRawItems: true });
const payload = context.buildLLMContextPayload();
const contextText = payload.workingMemory.text;
```

This merges all enabled lanes into a single working memory note that fits within the token budget. The framework handles prioritization, deduplication, and truncation — the decision module just passes the resulting text to the LLM prompt.

### 4. Automatic Archival and Audit Trail

Setting `archiveRawItems: true` archives processed evidence after each synthesis cycle. Every archive entry includes a full MST snapshot, creating an audit trail of what the LLM saw at each decision point. The bot also hooks into lifecycle events:

```typescript
traderContext.hooks.on?.("archive:created", (event) => {
  log.info(`AUDIT archive created: ${event.archiveId} at ${event.timestamp}`);
});
```

### Why This Matters

Without the framework, you'd be manually concatenating strings, guessing at token counts, and losing old context. With it, the bot gets:

- **Structured scoring** — high-severity evidence surfaces above low-severity noise
- **Budget guarantees** — the LLM prompt stays within token limits every cycle
- **Domain isolation** — lanes prevent one data source from starving another
- **Recency decay** — stale data naturally drops out of the selection window
- **Auditability** — every synthesis is archived with a full snapshot

## How It Works

Every ~5 minutes, the bot:

1. Fetches crypto news and clustered stories from the News API
2. Retrieves market quotes and dominance data
3. Calculates technical indicators (RSI, MACD) from 1-minute candles
4. Synthesizes all data through the Active Meta-Context framework
5. Calls LLM to decide: **buy**, **sell**, or **hold**
6. Executes market orders if the decision passes confidence and risk filters
7. Reports portfolio performance

## How well does it work?
This bot is intended as a proof-of-concept and research project. While it demonstrates the capabilities of LLMs in trading, it is not optimized for profitability or risk management. Use at your own risk and always paper trade before going live.

### Modules

| Module | Purpose |
|---|---|
| `main.ts` | Entry point; orchestrates the polling loop and portfolio reporting |
| `decision.ts` | Synthesizes context via `buildLLMContextPayload()` and returns buy/sell/hold with confidence |
| `clients.ts` | Initializes the Active Meta-Context with 5 lanes, seeds goals and constraints |
| `config.ts` | Environment variable loader with defaults |
| `trading.ts` | Executes decisions; enforces cooldowns, daily limits, and position size caps |
| `alpaca.ts` | Alpaca API wrapper for quotes, positions, orders, and asset discovery |
| `news.ts` | Fetches articles/stories from Perigon; upserts as Evidence into news-sentiment and market-events lanes |
| `coinmarketcap.ts` | Fetches CMC quotes, global metrics, trending coins; upserts into market-data and market-events lanes |
| `ta.ts` | Computes RSI, EMA, MACD from 1-minute bars; upserts into the market-data lane |
| `storage.ts` | Persistent storage (unstorage/fs driver) for decisions, trades, positions, and portfolio snapshots |

## Setup

```bash
cd examples/llm-trading-bot
bun install
cp .env.example .env
# Edit .env with your API keys
```

### Required API Keys

| Variable | Service |
|---|---|
| `OPENAI_API_KEY` | OpenAI GPT |
| `PERIGON_API_KEY` | Perigon news API |
| `ALPACA_API_KEY` | Alpaca trading |
| `ALPACA_API_SECRET` | Alpaca trading |
| `CCC_API_KEY` | CoinMarketCap |

### Configuration

See `.env.example` for all options. Key settings:

| Variable | Default | Description |
|---|---|---|
| `ALPACA_PAPER` | `true` | Paper trading mode (set `false` for live) |
| `POLL_INTERVAL_MS` | `300000` | Time between decision cycles (5 min) |
| `LLM_MODEL` | `gpt-4.1-mini` | GPT model |
| `TOKEN_BUDGET` | `1500` | Max tokens for synthesized context |
| `MIN_CONFIDENCE` | `0.8` | Minimum confidence to execute a trade |
| `COOLDOWN_MS` | `600000` | Minimum time between trades (10 min) |
| `MAX_TRADES_PER_DAY` | `100` | Daily trade limit |
| `MAX_POSITION_SIZE_USD` | `5000` | Max notional value per position |

## Usage

```bash
# Run the bot (continuous loop)
bun run start:crypto

# Run tests
bun test
```

### Safety Controls

- **Confidence threshold** - Trades only execute above `MIN_CONFIDENCE`
- **Cooldown timer** - Enforces minimum time between trades
- **Daily trade limit** - Caps total trades per day
- **Position size cap** - Limits notional value per position
- **Circuit breaker** - Trips on exchange errors to prevent cascading failures
- **Paper trading** - Test with simulated money before going live

### Data Storage

Decisions, trades, positions, and portfolio snapshots are persisted to `.data/crypto/`.
