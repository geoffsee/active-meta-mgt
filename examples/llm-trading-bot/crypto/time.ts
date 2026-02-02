export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function dayKeyET(d = new Date()): string {
  // YYYY-MM-DD in ET
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return fmt.format(d);
}

export function isRTH_ET(d = new Date()): boolean {
  // Rough RTH: Mon–Fri 9:30–16:00 ET
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = fmt.formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd);
  const mins = hh * 60 + mm;

  const open = 9 * 60 + 30;
  const close = 16 * 60;

  return isWeekday && mins >= open && mins <= close;
}

export function clampInt(n: number, min: number, max: number) {
  const x = Math.trunc(Number.isFinite(n) ? n : 0);
  return Math.max(min, Math.min(max, x));
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function daysTo(d: Date): number {
  const ms = d.getTime() - Date.now();
  return ms / (1000 * 60 * 60 * 24);
}
