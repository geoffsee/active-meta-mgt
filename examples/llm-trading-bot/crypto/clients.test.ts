import { describe, it, expect } from "bun:test";
import { openai, perigon, traderContext } from "./clients.ts";

describe("clients", () => {
  it("exports openai client", () => {
    expect(openai).toBeDefined();
    expect(openai.chat).toBeDefined();
  });

  it("exports perigon client", () => {
    expect(perigon).toBeDefined();
  });

  it("exports traderContext with lanes", () => {
    expect(traderContext).toBeDefined();
    expect(typeof traderContext.upsertEvidence).toBe("function");
    expect(typeof traderContext.upsertGoal).toBe("function");
    expect(typeof traderContext.synthesizeFromLanes).toBe("function");
  });
});
