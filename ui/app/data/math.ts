/**
 * Pure helpers shared by the Usage and Spend screens. No React, no SDK, so
 * tests/logic.test.mjs can check them directly.
 */

/** Median of a list (0 for an empty one). */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Day keys covering the period, oldest first, in the user's time zone:
 * `shift` is how many minutes it is ahead of UTC (0 gives UTC days).
 */
export function utcDaysBetween(fromIso: string, toIso: string, shift = 0): string[] {
  const out: string[] = [];
  const start = new Date(Date.parse(fromIso) + shift * 60000);
  let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const end = Date.parse(toIso) + shift * 60000;
  while (t <= end && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

/** Billing records lag up to 24 hours: any day that ends within that is still arriving. `shift` as above. */
export const stillArriving = (day: string, now: number = Date.now(), shift = 0) =>
  Date.parse(`${day}T00:00:00Z`) - shift * 60000 + 86400000 > now - 86400000;

/** The timeframe starts part-way through a day: its first day holds a few hours, not a dip. Drawn in outline, like a day still arriving. */
export const startsMidDay = (fromIso: string, shift = 0) => (Date.parse(fromIso) + shift * 60000) % 86400000 !== 0;

/** Lowest and highest 7-day average daily value over closed days; null with fewer than 7 closed days. */
export function dailyRange(days: Map<string, number>, keys: string[], now: number = Date.now(), shift = 0): [number, number] | null {
  const closed = keys.filter((k) => !stillArriving(k, now, shift));
  if (closed.length < 7) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 7 <= closed.length; i++) {
    const avg = closed.slice(i, i + 7).reduce((a, k) => a + (days.get(k) ?? 0), 0) / 7;
    lo = Math.min(lo, avg);
    hi = Math.max(hi, avg);
  }
  return [lo, hi];
}

/** 1, 2, 2.5 or 5 × a power of ten, at or above the given step (round gridline values). */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
