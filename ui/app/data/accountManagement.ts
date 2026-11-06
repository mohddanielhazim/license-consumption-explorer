import { functions } from "@dynatrace-sdk/app-utils";
import type { AmConnection } from "../rates";

/** Result shapes of api/am-connection.function.ts. */
export type AmFailure = { ok: false; step: string; status?: number; message: string };
export type AmSubscription = { uuid: string; name: string; status: string; startTime: string | null; endTime: string | null };
export type AmTest = { ok: true; subscriptions: AmSubscription[] };
/** One capability, one environment, one day (start and end as Account Management gives them). */
export type AmCostItem = { environmentId: string; key: string; name: string; value: number; currency: string; start: string | null; end: string | null; bookingDate: string | null };
export type AmUsageItem = { environmentId: string; key: string; name: string; value: number; unit: string; start: string | null; end: string | null };
export type AmCosts = {
  ok: true;
  subscription: { uuid: string; name?: string };
  costs: AmCostItem[];
  usages: AmUsageItem[];
  lastModifiedTime: string | null;
  /** False when Account Management had more pages than the app reads: totals are then too low. */
  complete: boolean;
  /** True when Account Management refused "every environment" and only this one was read. */
  environmentsLimited: boolean;
};

async function call<T>(data: Record<string, unknown>): Promise<T | AmFailure> {
  try {
    const res = await functions.call("am-connection", { data });
    return (await res.json()) as T | AmFailure;
  } catch (e) {
    return {
      ok: false,
      step: "app function",
      message: `The app's connection function could not run (${e instanceof Error ? e.message : String(e)}).`,
    };
  }
}

export const testConnection = (c: AmConnection) =>
  call<AmTest>({ action: "test", accountUuid: c.accountUuid, clientId: c.clientId, clientSecret: c.clientSecret });

export const fetchCosts = (c: AmConnection, startTime: string, endTime: string, environmentIds?: string[], fallbackEnvironmentIds?: string[]) =>
  call<AmCosts>({
    action: "costs",
    accountUuid: c.accountUuid,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    subscriptionUuid: c.subscriptionUuid ?? undefined,
    startTime,
    endTime,
    environmentIds,
    fallbackEnvironmentIds,
  });

/**
 * The last N complete UTC days, ending yesterday 00:00 UTC: billing records arrive
 * up to 24 hours late, so the day that ended at midnight is still filling in.
 * [yesterday 00:00 UTC − N days, yesterday 00:00 UTC).
 */
export function closedDays(n: number): { start: string; end: string } {
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86400000;
  return { start: new Date(end - n * 86400000).toISOString(), end: new Date(end).toISOString() };
}

/** One part of the extras: its data, or why it is missing. */
export type AmPart<T> = ({ ok: true } & T) | AmFailure;
export type AmBudget = { total: number; used: number | null; currency: string };
export type AmPeriod = { start: string; end: string; daysRemaining: number | null };
export type AmForecast = { median: number; lower: number | null; upper: number | null; budget: number | null; budgetPct: number | null; budgetDate: string | null; createdAt: string | null };
export type AmAlert = { date: string; severity: string; type: string; message: string };
export type AmAllocation = { date: string; capability: string; key: string | null; cost: number };
export type AmExtras = {
  ok: true;
  subscription: AmPart<{ budget: AmBudget | null; period: AmPeriod | null }>;
  forecast: AmPart<AmForecast | { median: null }>;
  alerts: AmPart<{ items: AmAlert[]; total: number | null }>;
  allocation: AmPart<{ items: AmAllocation[]; complete: boolean }>;
  accountCost: AmPart<{ byDay: Record<string, number>; currency: string }>;
};

/** Budget, forecast, alerts, Dynatrace's cost-centre split and cost for every environment (each may fail on its own). */
export const fetchExtras = (c: AmConnection, startTime: string, endTime: string, environmentId: string | null) =>
  call<AmExtras>({
    action: "extras",
    accountUuid: c.accountUuid,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    subscriptionUuid: c.subscriptionUuid ?? undefined,
    startTime,
    endTime,
    environmentIds: environmentId ? [environmentId] : undefined,
  });
