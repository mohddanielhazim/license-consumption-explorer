import { sameCapability } from "../capabilities";
import type { CapabilitySummary } from "../funnel";

/**
 * Contract rates from Account Management cost and the app's own billed usage
 * over the same closed days: rate = cost ÷ usage in rate units. Names are
 * matched with dashes and spacing normalised; rates are keyed by the app's
 * event.type. Cost with no matching usage is returned as unmatched. Costs in
 * a second currency are not summed in: they are returned as `mixed` and the
 * caller refuses to save. Pure, so tests/logic.test.mjs covers it.
 */
export function deriveContractRates(
  costs: { name: string; value: number; currency: string }[],
  summaries: CapabilitySummary[],
): { currency: string; rates: Record<string, number>; unmatched: string[]; unmatchedCost: { name: string; value: number }[]; total: number; mixed: boolean } {
  const currency = costs.find((c) => c.currency)?.currency ?? "";
  const mixed = costs.some((c) => c.currency && c.currency !== currency);
  const costByName = new Map<string, number>();
  for (const c of costs) if (!c.currency || c.currency === currency) costByName.set(c.name, (costByName.get(c.name) ?? 0) + c.value);
  const rates: Record<string, number> = {};
  const unmatched: string[] = [];
  const unmatchedCost: { name: string; value: number }[] = [];
  for (const [name, cost] of costByName) {
    const s = summaries.find((x) => sameCapability(x.eventType, name));
    const units = s && s.quantity !== null ? s.cap.toRateUnits(s.quantity) : 0;
    if (s && units > 0) rates[s.eventType] = (rates[s.eventType] ?? 0) + cost / units;
    else if (cost > 0) {
      unmatched.push(name);
      unmatchedCost.push({ name, value: cost });
    }
  }
  const total = [...costByName.values()].reduce((a, b) => a + b, 0);
  return { currency, rates, unmatched, unmatchedCost, total, mixed };
}

/**
 * Account Management cost per UTC day (yyyy-mm-dd), every capability summed,
 * in the given currency. Items without a start date are left out.
 */
export function billedByDay(costs: { value: number; currency: string; start: string | null }[], currency: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of costs) {
    if (!c.start || (c.currency && c.currency !== currency)) continue;
    const d = c.start.slice(0, 10);
    out[d] = (out[d] ?? 0) + c.value;
  }
  return out;
}

/** Dynatrace's cost-centre split summed over the period, largest first; null keys (no cost centre) kept as one row. */
export function allocationTotals(items: { key: string | null; cost: number }[]): { key: string | null; cost: number }[] {
  const m = new Map<string | null, number>();
  for (const i of items) m.set(i.key, (m.get(i.key) ?? 0) + i.cost);
  return [...m.entries()].map(([key, cost]) => ({ key, cost })).sort((a, b) => b.cost - a.cost);
}

const DAY_MS = 86400000;

/**
 * The finished UTC days inside a timeframe that Account Management has billed
 * figures for (v0.12.25): whole days only, from the first midnight at or after
 * the timeframe's start to the last midnight at or before its end, within the
 * days the figures were read for. A day with no figure was billed nothing.
 * Null when no whole day overlaps.
 */
export function billedCover(
  fromIso: string,
  toIso: string,
  billed: { periodStart: string; periodEnd: string; byDay: Record<string, number> },
): { startIso: string; endIso: string; days: string[]; amount: number } | null {
  const start = Math.max(Math.ceil(Date.parse(fromIso) / DAY_MS) * DAY_MS, Date.parse(billed.periodStart));
  const end = Math.min(Math.floor(Date.parse(toIso) / DAY_MS) * DAY_MS, Date.parse(billed.periodEnd));
  if (!(end > start)) return null;
  const days: string[] = [];
  let amount = 0;
  for (let t = start; t < end; t += DAY_MS) {
    const d = new Date(t).toISOString().slice(0, 10);
    days.push(d);
    amount += billed.byDay[d] ?? 0;
  }
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString(), days, amount };
}

/** Cost whose booking date falls on a later UTC day than its usage day, in the given currency. */
export function bookedLater(costs: { value: number; currency: string; start: string | null; bookingDate: string | null }[], currency: string): number {
  return costs
    .filter((c) => c.start && c.bookingDate && (!c.currency || c.currency === currency) && c.bookingDate.slice(0, 10) > c.start.slice(0, 10))
    .reduce((a, c) => a + c.value, 0);
}
