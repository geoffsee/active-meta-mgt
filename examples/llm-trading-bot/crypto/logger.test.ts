import { describe, it, expect, jest } from "bun:test";
import { createLogger, colors, rootLogger, type Logger } from "./logger.ts";

describe("createLogger", () => {
  it("returns an object with debug, info, warn, error methods", () => {
    const log = createLogger("test-scope");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("info logs include the scope and message", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger("my-scope");
    log.info("hello world");
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain("my-scope");
    expect(output).toContain("hello world");
    expect(output).toContain("INFO");
    spy.mockRestore();
  });

  it("warn logs to console.warn", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("w");
    log.warn("caution");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as string)).toContain("WARN");
    spy.mockRestore();
  });

  it("error logs to console.error", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("e");
    log.error("fail");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as string)).toContain("ERROR");
    spy.mockRestore();
  });
});

describe("colors", () => {
  it("exports ANSI escape codes", () => {
    expect(colors.reset).toBe("\x1b[0m");
    expect(colors.red).toBe("\x1b[31m");
    expect(colors.green).toBe("\x1b[32m");
  });
});

describe("rootLogger", () => {
  it("is a Logger with scope 'app'", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    rootLogger.info("root test");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as string)).toContain("app");
    spy.mockRestore();
  });
});
