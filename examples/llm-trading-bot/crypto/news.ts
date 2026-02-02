import { config } from "./config.ts";
import { perigon, traderContext } from "./clients.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("crypto-news");

const seenEvidenceIds = new Set<string>();

const CRYPTO_KEYWORDS = "bitcoin OR ethereum OR crypto OR SEC OR ETF OR halving OR whale OR DeFi OR regulation OR hack OR stablecoin OR fed OR inflation";

export async function fetchAndUpsertNews(now: () => number = Date.now) {
  const fromDate = new Date(now() - config.NEWS_LOOKBACK_MS);

  try {
    log.info(
      `Fetching crypto news window ${fromDate.toISOString()} to ${new Date(now()).toISOString()} ` +
      `(articles size=${config.ARTICLES_PAGE_SIZE}, stories size=${config.STORIES_PAGE_SIZE})`,
    );

    const { articles } = await perigon.searchArticles({
      q: `(cryptocurrency OR crypto) AND (${CRYPTO_KEYWORDS})`,
      from: fromDate,
      size: config.ARTICLES_PAGE_SIZE,
      sortBy: "relevance",
    });

    for (const a of articles ?? []) {
      const aAny = a as any;
      const stableId = aAny.id ? `perigon-crypto-article-${aAny.id}` : `perigon-crypto-article-${a.url ?? a.title}`;
      if (seenEvidenceIds.has(stableId)) continue;
      seenEvidenceIds.add(stableId);

      traderContext.upsertEvidence({
        id: stableId,
        summary: `${a.title ?? "(untitled)"}: ${a.description ?? ""}`.trim(),
        detail: (a.content ?? a.description ?? "").slice(0, 1400),
        severity: "medium",
        confidence: "high",
        tags: [
          { key: "lane", value: "news-sentiment" },
          { key: "ticker", value: config.CRYPTO_TICKER },
          { key: "source", value: "perigon" },
        ],
        provenance: {
          source: "web",
          createdAt: new Date((a as any).pubDate ?? (a as any).publishedAt ?? now()).toISOString(),
        },
      });

      log.debug(`UPSERT News: ${stableId} (${a.title ?? ""})`);
    }

    const { results: stories } = await perigon.searchStories({
      q: `crypto OR cryptocurrency`,
      size: config.STORIES_PAGE_SIZE,
    });

    for (const s of stories ?? []) {
      const sAny = s as any;
      const stableId = s.id ? `perigon-crypto-story-${s.id}` : `perigon-crypto-story-${sAny.title ?? s.name}`;
      if (seenEvidenceIds.has(stableId)) continue;
      seenEvidenceIds.add(stableId);

      traderContext.upsertEvidence({
        id: stableId,
        summary: sAny.title ?? s.name ?? "(story)",
        detail: (s.summary ?? "").slice(0, 1400),
        severity: "low",
        confidence: "medium",
        tags: [
          { key: "lane", value: "market-events" },
          { key: "ticker", value: config.CRYPTO_TICKER },
          { key: "source", value: "perigon" },
        ],
        provenance: { source: "web", createdAt: new Date(now()).toISOString() },
      });

      log.info(`UPSERT Story: ${stableId}`);
    }
    log.info(`Crypto news ingest done: ${articles?.length ?? 0} articles, ${stories?.length ?? 0} stories processed`);
  } catch (err) {
    log.error(`Perigon fetch failed: ${(err as Error).message}`);
  }
}
