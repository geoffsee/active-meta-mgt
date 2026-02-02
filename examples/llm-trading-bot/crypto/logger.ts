export type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (env === "debug" || env === "info" || env === "warn" || env === "error") return env;
  return "info";
}

const globalLevel = resolveLevel();

// ANSI color codes
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
};

export { c as colors };

const levelColors: Record<LogLevel, string> = {
  debug: c.gray,
  info: c.cyan,
  warn: c.yellow,
  error: c.red,
};

function fmt(scope: string, level: LogLevel, msg: string) {
  const ts = new Date().toISOString();
  const lc = levelColors[level];
  return `${c.dim}${ts}${c.reset} ${lc}${level.toUpperCase().padEnd(5)}${c.reset} ${c.magenta}${scope}${c.reset} ${msg}`;
}

export type Logger = {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export function createLogger(scope: string): Logger {
  const should = (level: LogLevel) => levelOrder[level] >= levelOrder[globalLevel];

  return {
    debug: (msg: string) => {
      if (should("debug")) console.debug(fmt(scope, "debug", msg));
    },
    info: (msg: string) => {
      if (should("info")) console.log(fmt(scope, "info", msg));
    },
    warn: (msg: string) => {
      if (should("warn")) console.warn(fmt(scope, "warn", msg));
    },
    error: (msg: string) => {
      if (should("error")) console.error(fmt(scope, "error", msg));
    },
  };
}

// shared root logger for quick use
export const rootLogger = createLogger("app");
