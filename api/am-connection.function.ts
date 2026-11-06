/**
 * 2026-10-08). Runs server-side because the OAuth token endpoint
 * (sso.dynatrace.com) sends no CORS headers and a client secret must never be
 * used from browser code. Called only on "Test connection" and when rates or
 * the reconcile view are refreshed, never on a timer.
 *
 * API (docs.dynatrace.com, Dynatrace Platform Subscription API):
 *   token:   POST https://sso.dynatrace.com/sso/oauth2/token
 *            client_credentials, scope account-uac-read, resource urn:dtaccount:<uuid>
 *   subs:    GET  https://api.dynatrace.com/sub/v2/accounts/{acc}/subscriptions
 *   cost:    GET  https://api.dynatrace.com/sub/v3/accounts/{acc}/subscriptions/{sub}/environments/cost
 *   usage:   GET  https://api.dynatrace.com/sub/v3/accounts/{acc}/subscriptions/{sub}/environments/usage
 *            (v2 deprecated 2026-06-15, sunset 2027-01-11: used only when v3 answers 404 or 410)
 * Both answer in pages (nextPageKey); every page is read, up to MAX_PAGES. Cost
 * items are one day each, so the per-day start and end are kept.
 * NOT VERIFIED against a live account: the development environment has no subscription attached.
 */

type Payload = {
  action: "test" | "costs" | "extras";
  accountUuid: string;
  clientId: string;
  clientSecret: string;
  subscriptionUuid?: string;
  /** Limits cost and usage to these environments; omit for all environments. */
  environmentIds?: string[];
  /** Used when Account Management refuses a request without environment IDs. */
  fallbackEnvironmentIds?: string[];
  startTime?: string;
  endTime?: string;
};

type Failure = { ok: false; step: string; status?: number; message: string };

const API = "https://api.dynatrace.com/sub";
/** Strict 8-4-4-4-12: both account and subscription ids go into URL paths. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_ID = /^[a-z0-9-]{3,64}$/i;
/** Each upstream call gets 15 s. */
const TIMEOUT_MS = 15000;
/** Pages read per list; beyond this the result says it is incomplete rather than looping on. */
const MAX_PAGES = 40;

async function readJson(res: Response, step: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return { ok: false, step, message: `The ${step} response was not readable (HTTP ${res.status}). Try again later.` } satisfies Failure;
  }
}

const timedOut = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

async function token(p: Payload): Promise<string | Failure> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: p.clientId,
    client_secret: p.clientSecret,
    scope: "account-uac-read",
    resource: `urn:dtaccount:${p.accountUuid}`,
  });
  let res: Response;
  try {
    res = await fetch("https://sso.dynatrace.com/sso/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return {
      ok: false,
      step: "token",
      message: timedOut(e)
        ? "sso.dynatrace.com did not answer within 15 seconds. Try again; if it keeps happening, check that outbound connections to sso.dynatrace.com are allowed."
        : "Could not reach sso.dynatrace.com. If your environment limits outbound connections, allow sso.dynatrace.com and api.dynatrace.com.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      step: "token",
      status: res.status,
      message:
        res.status === 400 || res.status === 401
          ? "The client ID, secret or account ID was not accepted. Check all three, and that the client has the account permission 'View usage and consumption' (account-uac-read)."
          : `The token request failed with HTTP ${res.status}.`,
    };
  }
  const json = await readJson(res, "token");
  if (isFailure(json)) return json;
  const tokenValue = (json as { access_token?: unknown }).access_token;
  return typeof tokenValue === "string" && tokenValue ? tokenValue : { ok: false, step: "token", message: "The token response had no access token." };
}

async function get(url: string, bearer: string, step: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(
      url,
      body === undefined
        ? { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
        : { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
  } catch (e) {
    return {
      ok: false,
      step,
      message: timedOut(e) ? `api.dynatrace.com did not answer the ${step} request within 15 seconds. Try again.` : "Could not reach api.dynatrace.com.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      step,
      status: res.status,
      message:
        res.status === 403
          ? "The client was accepted but may not read usage and consumption. Give it the account permission 'View usage and consumption'."
          : `The ${step} request failed with HTTP ${res.status}.`,
    };
  }
  return readJson(res, step);
}

/**
 * Every page of a list: the first request carries the query, each next one only
 * the page key (Account Management requires one or the other).
 */
async function getAll(url: string, query: URLSearchParams, bearer: string, step: string): Promise<{ data: unknown[]; lastModifiedTime: string | null; complete: boolean } | Failure> {
  const data: unknown[] = [];
  let lastModifiedTime: string | null = null;
  let next: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = next ? new URLSearchParams({ "page-key": next }) : query;
    const res = await get(`${url}?${q.toString()}`, bearer, step);
    if (isFailure(res)) return res;
    const body = res as { data?: unknown; lastModifiedTime?: unknown; nextPageKey?: unknown };
    if (Array.isArray(body.data)) data.push(...(body.data as unknown[]));
    if (typeof body.lastModifiedTime === "string") lastModifiedTime ??= body.lastModifiedTime;
    next = typeof body.nextPageKey === "string" && body.nextPageKey ? body.nextPageKey : null;
    if (!next) return { data, lastModifiedTime, complete: true };
  }
  return { data, lastModifiedTime, complete: false };
}

const isFailure = (v: unknown): v is Failure =>
  typeof v === "object" && v !== null && (v as { ok?: unknown }).ok === false;

type Subscription = { uuid: string; name?: string; status?: string; startTime?: string; endTime?: string };
type CostItem = { capabilityKey?: string; capabilityName?: string; value?: number; currencyCode?: string; startTime?: string; endTime?: string; bookingDate?: string };
type UsageItem = { capabilityKey?: string; capabilityName?: string; value?: number; unitMeasure?: string; startTime?: string; endTime?: string };
const day = (v: unknown) => (typeof v === "string" && v ? v : null);

export default async function (payload: unknown = undefined) {
  const p = payload as Payload | undefined;
  if (!p || typeof p !== "object" || (p.action !== "test" && p.action !== "costs" && p.action !== "extras")) {
    return { ok: false, step: "input", message: "Unknown request." } as Failure;
  }
  if (!UUID.test(p.accountUuid ?? "") || typeof p.clientId !== "string" || !p.clientId || typeof p.clientSecret !== "string" || !p.clientSecret) {
    return { ok: false, step: "input", message: "Account ID (a UUID), client ID and client secret are all required." } as Failure;
  }
  if (p.subscriptionUuid != null && !UUID.test(p.subscriptionUuid)) {
    return { ok: false, step: "input", message: "The subscription ID is not a UUID." } as Failure;
  }
  const envListOk = (v: unknown) => v == null || (Array.isArray(v) && v.every((e) => typeof e === "string" && ENV_ID.test(e)));
  if (!envListOk(p.environmentIds) || !envListOk(p.fallbackEnvironmentIds)) {
    return { ok: false, step: "input", message: "Environment IDs must be plain environment identifiers." } as Failure;
  }

  const t = await token(p);
  if (typeof t !== "string") return t;

  const subs = await get(`${API}/v2/accounts/${p.accountUuid}/subscriptions`, t, "subscriptions");
  if (isFailure(subs)) return subs;
  const subData = (subs as { data?: unknown }).data;
  const list = (Array.isArray(subData) ? (subData as Subscription[]) : []).filter((s) => s && UUID.test(String(s.uuid))).map((s) => ({
    uuid: s.uuid,
    name: s.name ?? s.uuid,
    status: s.status ?? "unknown",
    startTime: s.startTime ?? null,
    endTime: s.endTime ?? null,
  }));
  if (p.action === "test") return { ok: true, subscriptions: list };

  const sub = p.subscriptionUuid ?? list.find((s) => s.status === "ACTIVE")?.uuid ?? list[0]?.uuid;
  if (!sub) return { ok: false, step: "subscriptions", message: "The account has no subscription." } as Failure;
  if (!p.startTime || !p.endTime) return { ok: false, step: "input", message: "A start and end time are required." } as Failure;
  if (p.action === "extras") return extras(p, t, sub);

  const query = (envs?: string[]) => {
    const q = new URLSearchParams({ startTime: p.startTime!, endTime: p.endTime! });
    if (envs?.length) q.set("environmentIds", envs.join(","));
    return q;
  };
  const base = `${API}/v3/accounts/${p.accountUuid}/subscriptions/${sub}/environments`;

  // The v3 reference lists environmentIds as required: when a request for every
  // environment is refused, ask again for the fallback list and say so.
  let envs = p.environmentIds;
  let environmentsLimited = false;
  let cost = await getAll(`${base}/cost`, query(envs), t, "cost");
  if (isFailure(cost) && cost.status === 400 && !envs?.length && p.fallbackEnvironmentIds?.length) {
    envs = p.fallbackEnvironmentIds;
    environmentsLimited = true;
    cost = await getAll(`${base}/cost`, query(envs), t, "cost");
  }
  if (isFailure(cost)) return cost;
  let usage = await getAll(`${base}/usage`, query(envs), t, "usage");
  if (isFailure(usage) && (usage.status === 404 || usage.status === 410)) {
    usage = await getAll(`${API}/v2/accounts/${p.accountUuid}/subscriptions/${sub}/environments/usage`, query(envs), t, "usage");
  }
  if (isFailure(usage)) return usage;

  // Per environment, capability and day; keep both key and name (the name is what matches event.type).
  const costs: { environmentId: string; key: string; name: string; value: number; currency: string; start: string | null; end: string | null; bookingDate: string | null }[] = [];
  for (const env of cost.data as { environmentId?: string; cost?: CostItem[] }[]) {
    for (const c of Array.isArray(env?.cost) ? env.cost : []) {
      costs.push({
        environmentId: env.environmentId ?? "",
        key: c.capabilityKey ?? "",
        name: c.capabilityName ?? c.capabilityKey ?? "",
        value: Number(c.value) || 0,
        currency: c.currencyCode ?? "",
        start: day(c.startTime),
        end: day(c.endTime),
        bookingDate: day(c.bookingDate),
      });
    }
  }
  const usages: { environmentId: string; key: string; name: string; value: number; unit: string; start: string | null; end: string | null }[] = [];
  for (const env of usage.data as { environmentId?: string; usage?: UsageItem[] }[]) {
    for (const u of Array.isArray(env?.usage) ? env.usage : []) {
      usages.push({
        environmentId: env.environmentId ?? "",
        key: u.capabilityKey ?? "",
        name: u.capabilityName ?? u.capabilityKey ?? "",
        value: Number(u.value) || 0,
        unit: u.unitMeasure ?? "",
        start: day(u.startTime),
        end: day(u.endTime),
      });
    }
  }
  return {
    ok: true,
    subscription: list.find((s) => s.uuid === sub) ?? { uuid: sub },
    costs,
    usages,
    lastModifiedTime: cost.lastModifiedTime,
    /** False when a list had more than MAX_PAGES pages: the totals are then too low. */
    complete: cost.complete && usage.complete,
    environmentsLimited,
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" && v ? v : null);
/** One part of the extras: its data, or why it is missing. A failed part never fails the others. */
type Part<T> = ({ ok: true } & T) | Failure;

/**
 * What else Account Management documents for the account-uac-read scope
 * (v0.12.25). Each part is read on its own and may fail on its own.
 * NOT VERIFIED against a live account; shapes from docs.dynatrace.com:
 *   subscription  GET  /sub/v2/accounts/{acc}/subscriptions/{sub}     budget, currentPeriod
 *   forecast      GET  /sub/v2/accounts/{acc}/subscriptions/forecast
 *   alerts        POST /v1/accounts/{acc}/notifications                FORECAST, BUDGET, COST
 *   allocation    GET  /v1/subscriptions/{sub}/cost-allocation         field=COSTCENTER, per day
 *   accountCost   GET  /sub/v2/accounts/{acc}/subscriptions/{sub}/cost every environment, per day
 */
async function extras(p: Payload, t: string, sub: string) {
  const env = p.environmentIds?.[0] ?? p.fallbackEnvironmentIds?.[0] ?? null;
  const day = (iso: string) => iso.slice(0, 10);

  const subscription = async (): Promise<Part<{ budget: { total: number; used: number | null; currency: string } | null; period: { start: string; end: string; daysRemaining: number | null } | null }>> => {
    const r = await get(`${API}/v2/accounts/${p.accountUuid}/subscriptions/${sub}`, t, "subscription");
    if (isFailure(r)) return r;
    const b = (r as { budget?: Record<string, unknown> }).budget;
    const c = (r as { currentPeriod?: Record<string, unknown> }).currentPeriod;
    const total = num(b?.total);
    const start = text(c?.startTime);
    const end = text(c?.endTime);
    return {
      ok: true,
      budget: total !== null ? { total, used: num(b?.used), currency: text(b?.currencyCode) ?? "" } : null,
      period: start && end ? { start, end, daysRemaining: num(c?.daysRemaining) } : null,
    };
  };

  const forecast = async (): Promise<Part<{ median: number; lower: number | null; upper: number | null; budget: number | null; budgetPct: number | null; budgetDate: string | null; createdAt: string | null } | { median: null }>> => {
    const r = await get(`${API}/v2/accounts/${p.accountUuid}/subscriptions/forecast`, t, "forecast");
    if (isFailure(r)) return r;
    const f = r as Record<string, unknown>;
    const median = num(f.forecastMedian);
    if (median === null) return { ok: true, median: null };
    return { ok: true, median, lower: num(f.forecastLower), upper: num(f.forecastUpper), budget: num(f.budget), budgetPct: num(f.forecastBudgetPct), budgetDate: text(f.forecastBudgetDate), createdAt: text(f.forecastCreatedAt) };
  };

  const alerts = async (): Promise<Part<{ items: { date: string; severity: string; type: string; message: string }[]; total: number | null }>> => {
    const r = await get(`https://api.dynatrace.com/v1/accounts/${p.accountUuid}/notifications`, t, "alerts", {
      startDateTime: p.startTime,
      endDateTime: p.endTime,
      types: ["FORECAST", "BUDGET", "COST"],
      page: 1,
      pageSize: 50,
      sorts: ["-date"],
    });
    if (isFailure(r)) return r;
    const records = (r as { records?: unknown }).records;
    const items = (Array.isArray(records) ? (records as Record<string, unknown>[]) : []).flatMap((n) => {
      const message = text(n?.message);
      const date = text(n?.date);
      return message && date ? [{ date, severity: (text(n.severity) ?? "").toUpperCase(), type: (text(n.type) ?? "").toUpperCase(), message }] : [];
    });
    return { ok: true, items, total: num((r as { totalRecordCount?: unknown }).totalRecordCount) };
  };

  const allocation = async (): Promise<Part<{ items: { date: string; capability: string; key: string | null; cost: number }[]; complete: boolean }>> => {
    if (!env) return { ok: false, step: "allocation", message: "No environment to read the cost allocation for." };
    const items: { date: string; capability: string; key: string | null; cost: number }[] = [];
    let next: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ field: "COSTCENTER", "environment-id": env, from: day(p.startTime!), to: day(p.endTime!) });
      if (next) q.set("page-key", next);
      const r = await get(`https://api.dynatrace.com/v1/subscriptions/${sub}/cost-allocation?${q.toString()}`, t, "allocation");
      if (isFailure(r)) return r;
      const records = (r as { records?: unknown }).records;
      for (const rec of Array.isArray(records) ? (records as Record<string, unknown>[]) : []) {
        const cost = num(rec?.costs) ?? num(rec?.cost);
        const date = text(rec?.date);
        if (cost === null || !date) continue;
        items.push({ date: date.slice(0, 10), capability: text(rec.capability) ?? "", key: text(rec.key), cost });
      }
      const k = (r as { nextPageKey?: unknown }).nextPageKey;
      next = typeof k === "string" && k ? k : null;
      if (!next) return { ok: true, items, complete: true };
    }
    return { ok: true, items, complete: false };
  };

  const accountCost = async (): Promise<Part<{ byDay: Record<string, number>; currency: string }>> => {
    const r = await get(`${API}/v2/accounts/${p.accountUuid}/subscriptions/${sub}/cost`, t, "account cost");
    if (isFailure(r)) return r;
    const data = (r as { data?: unknown }).data;
    const byDay: Record<string, number> = {};
    let currency = "";
    const from = Date.parse(p.startTime!);
    const to = Date.parse(p.endTime!);
    for (const c of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
      const start = text(c?.startTime);
      const value = num(c?.value);
      if (!start || value === null) continue;
      const at = Date.parse(start);
      if (!(at >= from && at < to)) continue;
      currency ||= text(c.currencyCode) ?? "";
      byDay[day(start)] = (byDay[day(start)] ?? 0) + value;
    }
    return { ok: true, byDay, currency };
  };

  const guard = async <T,>(step: string, f: () => Promise<Part<T>>): Promise<Part<T>> => {
    try {
      return await f();
    } catch (e) {
      return { ok: false, step, message: e instanceof Error ? e.message : String(e) };
    }
  };
  const [s1, s2, s3, s4, s5] = await Promise.all([
    guard("subscription", subscription),
    guard("forecast", forecast),
    guard("alerts", alerts),
    guard("allocation", allocation),
    guard("account cost", accountCost),
  ]);
  return { ok: true, subscription: s1, forecast: s2, alerts: s3, allocation: s4, accountCost: s5 };
}
