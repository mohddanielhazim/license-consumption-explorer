import { getRegionalFormat, getTimezone } from "@dynatrace-sdk/user-preferences";

/**
 * The user's Dynatrace regional format (e.g. "en-GB", "de-DE"), used for
 * every number and date. Falls back to the browser's locale if the platform
 * cannot answer. Billing day boundaries are always labelled UTC.
 */
export function appLocale(): string | undefined {
  try {
    const f = getRegionalFormat();
    return f && Intl.NumberFormat.supportedLocalesOf([f]).length > 0 ? f : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The user's Dynatrace time zone (Profile > Time zone, e.g. "Asia/Kuala_Lumpur"),
 * for clock times such as "Data as of" and for where each day starts and ends
 * in daily charts. Falls back to the browser's zone. (Account Management shows
 * UTC days, so one day's figure there can differ slightly; totals match.)
 */
export function appTimeZone(): string {
  const valid = (z: unknown): z is string => {
    if (typeof z !== "string" || !z) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: z });
      return true;
    } catch {
      return false;
    }
  };
  try {
    const z = getTimezone();
    if (valid(z)) return z;
  } catch {
    /* platform could not answer */
  }
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return valid(browser) ? browser : "UTC";
}

/** A moment as date and clock time in the user's time zone, with the zone named: "Oct 9, 2026, 2:50 PM GMT+8". */
export function formatMoment(when: Date): string {
  return new Intl.DateTimeFormat(appLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: appTimeZone(),
    timeZoneName: "short",
  }).format(when);
}

/** A calendar day ("2026-09-15") in the user's regional format, no time. */
export function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return new Intl.DateTimeFormat(appLocale(), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Minutes the user's time zone is ahead of UTC at a moment (Kuala Lumpur: 480). */
export function dayShiftMinutes(at: number = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: appTimeZone(),
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(new Date(at));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
    return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000);
  } catch {
    return 0;
  }
}

/** The zone as people read it: "GMT+8", or "UTC". */
export function zoneLabel(at: number = Date.now()): string {
  const m = dayShiftMinutes(at);
  if (m === 0) return "UTC";
  const h = Math.floor(Math.abs(m) / 60);
  const mm = Math.abs(m) % 60;
  return `GMT${m > 0 ? "+" : "−"}${h}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
}

/** Closed UTC days [start, end): "Sep 15, 2026 to Oct 14, 2026", naming the last day included. */
export function formatDayRange(startIso: string, endIsoExclusive: string): string {
  const last = new Date(Date.parse(endIsoExclusive) - 86400000).toISOString();
  return `${formatDay(startIso)} to ${formatDay(last)}`;
}

/** A size of change in percent, as every comparison sentence prints it: one decimal under 10%, whole above. `pct` is already ×100. */
export function formatChangePct(pct: number): string {
  const a = Math.abs(pct);
  return `${a >= 10 ? Math.round(a) : a.toFixed(1)}%`;
}
