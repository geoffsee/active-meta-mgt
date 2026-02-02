import { describe, it, expect, mock } from "bun:test";
import { fetchAndUpsertNews } from "./news.ts";

// news.ts imports perigon from clients.ts which is constructed at module load.
// We can only test that the function doesn't throw when the API errors out,
// since we can't easily mock the perigon client without DI.

describe("fetchAndUpsertNews", () => {
  it("does not throw on perigon API error", async () => {
    // perigon will fail with test API keys — should be caught internally
    await expect(fetchAndUpsertNews()).resolves.toBeUndefined();
  });
});
