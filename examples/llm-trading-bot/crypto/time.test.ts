import { describe, it, expect } from "vitest";
import { sleep, dayKeyET, isRTH_ET, clampInt, round2, daysTo } from "./time.ts";

describe("sleep", () => {
  it("resolves after the given ms", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("dayKeyET", () => {
  it("returns YYYY-MM-DD format", () => {
    const key = dayKeyET(new Date("2025-06-15T12:00:00Z"));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("defaults to now without throwing", () => {
    expect(typeof dayKeyET()).toBe("string");
  });
});

describe("isRTH_ET", () => {
  it("returns true during RTH on a weekday", () => {
    // Wed 2025-06-11 12:00 ET = 16:00 UTC
    expect(isRTH_ET(new Date("2025-06-11T16:00:00Z"))).toBe(true);
  });

  it("returns false on a weekend", () => {
    // Sun 2025-06-15 12:00 ET = 16:00 UTC
    expect(isRTH_ET(new Date("2025-06-15T16:00:00Z"))).toBe(false);
  });

  it("returns false before market open", () => {
    // Wed 2025-06-11 08:00 ET = 12:00 UTC
    expect(isRTH_ET(new Date("2025-06-11T12:00:00Z"))).toBe(false);
  });

  it("returns false after market close", () => {
    // Wed 2025-06-11 17:00 ET = 21:00 UTC
    expect(isRTH_ET(new Date("2025-06-11T21:00:00Z"))).toBe(false);
  });
});

describe("clampInt", () => {
  it("clamps within range", () => {
    expect(clampInt(5, 0, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clampInt(-3, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clampInt(20, 0, 10)).toBe(10);
  });

  it("truncates floats", () => {
    expect(clampInt(3.9, 0, 10)).toBe(3);
  });

  it("handles NaN as 0", () => {
    expect(clampInt(NaN, -5, 5)).toBe(0);
  });

  it("handles Infinity as 0", () => {
    expect(clampInt(Infinity, -5, 5)).toBe(0);
  });
});

describe("round2", () => {
  it("rounds to two decimal places", () => {
    expect(round2(1.005)).toBeCloseTo(1.0, 1);
    expect(round2(1.999)).toBe(2);
    expect(round2(3.14159)).toBe(3.14);
  });

  it("handles integers", () => {
    expect(round2(5)).toBe(5);
  });
});

describe("daysTo", () => {
  it("returns positive for future dates", () => {
    const future = new Date(Date.now() + 2 * 86_400_000);
    expect(daysTo(future)).toBeGreaterThan(1.9);
  });

  it("returns negative for past dates", () => {
    const past = new Date(Date.now() - 86_400_000);
    expect(daysTo(past)).toBeLessThan(0);
  });
});
