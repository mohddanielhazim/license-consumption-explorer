import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { logQuery } from "../data/queryLog";
import { forEntityMode, isMissingClassicError, isSmartscapeError, noteEntityError, useEntityMode } from "../data/entities";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { useDql } from "@dynatrace-sdk/react-hooks";

import { color, font, radius, space, type, layout } from "../design/tokens";
import { Headline } from "./Info";
import { Card, SecondaryButton } from "../design/primitives";
import { TimeframeSelector } from "@dynatrace/strato-components/filters";
import { parseTimeAsTimeValue } from "@dynatrace-sdk/units";
import { dayShiftMinutes, formatMoment } from "../locale";
import { fillPeriod } from "../data/period";
import { MSG } from "../strings";
export { USAGE_TIME, fillPeriod } from "../data/period";

/**
 * Timeframe: any start and end, including recent hours and today. Ranges are
 * never blocked; incomplete days are labelled "still arriving" instead. The
 * only hard limit is 365 days back, the billing data retention.
 * The URL keeps what the person chose (expressions like now-30d stay
 * relative); queries get exact UTC times resolved once per choice and on
 * Refresh, so every query on a page covers the same period.
 */
export const PRESETS = [
  { label: "Last 24 hours", from: "now-24h" },
  { label: "Last 7 days", from: "now-7d" },
  { label: "Last 30 days", from: "now-30d" },
  { label: "Last 90 days", from: "now-90d" },
  { label: "Last 365 days", from: "now-365d" },
];
const DEFAULT_RANGE = { from: "now-30d", to: "now" };
export const RETENTION_DAYS = 365;

/**
 * shorter previous window makes any flat usage look like a rise), `arriving` when this
 * timeframe ends within the last day, so its newest records are still coming in.
 */
export function comparisonWindow(period: { fromIso: string; toIso: string; fetchToIso: string }) {
  const from = Date.parse(period.fromIso);
  const to = Date.parse(period.toIso);
  const prevFrom = from - (to - from);
  const floor = Math.floor(Date.now() / 60000) * 60000 - RETENTION_DAYS * 86400000;
  return {
    prevFromIso: new Date(Math.max(prevFrom, floor)).toISOString(),
    truncated: prevFrom < floor,
    arriving: Date.parse(period.fetchToIso) - to < 86400000 - 60000,
  };
}

/** The chosen range as a stable key "from|to", plus a setter. Kept in the URL. */
export function useTimeframe(): [string, (from: string, to: string) => void] {
  const [params, setParams] = useSearchParams();
  let from = params.get("from");
  let to = params.get("to");
  const legacy = params.get("tf"); // older links: ?tf=-30d
  if (!from && legacy && /^-\d+[hdwMy]$/.test(legacy)) from = `now${legacy}`;
  if (!from || !parseTimeAsTimeValue(from)) from = DEFAULT_RANGE.from;
  if (!to || !parseTimeAsTimeValue(to)) to = DEFAULT_RANGE.to;
  const set = (nextFrom: string, nextTo: string) => {
    const p = new URLSearchParams(params);
    p.delete("tf");
    p.set("from", nextFrom);
    p.set("to", nextTo);
    setParams(p);
  };
  return [`${from}|${to}`, set];
}

export type Period = {
  from: string;
  to: string;
  fromIso: string;
  toIso: string;
  /** Write-time end of the fetch: 24 hours past toIso, capped at the moment the period was resolved. */
  fetchToIso: string;
  /** True when the start was moved forward to the 365-day retention limit. */
  clamped: boolean;
  /** "the last 30 days", or exact dates for a custom range. */
  phrase: string;
};

const resolved = new Map<string, Period>();
const UNIT_WORD: Record<string, [string, string]> = {
  m: ["minute", "minutes"],
  h: ["hour", "hours"],
  d: ["day", "days"],
  w: ["week", "weeks"],
  M: ["month", "months"],
  y: ["year", "years"],
};

function describe(from: string, to: string, fromIso: string, toIso: string): string {
  // "now-30d" (the presets) and "now()-30d" (DQL style, typed into the URL) read the same.
  const rel = /^now(?:\(\))?-(\d+)([mhdwMy])$/.exec(from);
  if (rel && (to === "now" || to === "now()")) {
    const n = Number(rel[1]);
    const [one, many] = UNIT_WORD[rel[2]];
    return n === 1 ? `the last ${one}` : `the last ${n} ${many}`;
  }
  // Clock times in the user's own Dynatrace time zone, the zone named.
  return `the timeframe from ${formatMoment(new Date(fromIso))} to ${formatMoment(new Date(toIso))}`;
}

/** Resolve a range to exact UTC times, once per range and refresh. */
export function resolvePeriod(key: string, token: number): Period {
  const cacheKey = `${key}#${token}`;
  const hit = resolved.get(cacheKey);
  if (hit) return hit;
  const [from, to] = key.split("|");
  const now = Math.floor(Date.now() / 60000) * 60000;
  const toDate = new Date(parseTimeAsTimeValue(to, now)?.absoluteDate ?? now);
  let fromDate = new Date(parseTimeAsTimeValue(from, now)?.absoluteDate ?? now - 30 * 86400000);
  const floor = now - RETENTION_DAYS * 86400000;
  const clamped = fromDate.getTime() < floor;
  if (clamped) fromDate = new Date(floor);
  if (fromDate.getTime() > toDate.getTime()) fromDate = new Date(toDate.getTime() - 3600000);
  const period: Period = {
    from,
    to,
    fromIso: fromDate.toISOString(),
    toIso: toDate.toISOString(),
    // Billing records are written after the usage they describe (up to ~24 h for some
    // types), so queries fetch by write time to 24 h past the period end (never past
    // now) and then keep records by their usage time ({IN_PERIOD}).
    fetchToIso: new Date(Math.min(toDate.getTime() + 86400000, now)).toISOString(),
    clamped,
    phrase: "",
  };
  period.phrase = describe(from, to, period.fromIso, period.toIso);
  resolved.set(cacheKey, period);
  return period;
}

export function usePeriod(): Period {
  const [key] = useTimeframe();
  const { token } = useContext(RefreshContext);
  return resolvePeriod(key, token);
}

/** "the last 30 days" etc. Kept for screens that build their own sentences. */
export function periodPhrase(key: string): string {
  return resolvePeriod(key, 0).phrase;
}

/** Builds an in-app link that carries the current timeframe. */
export function useAppHref(): (path: string) => string {
  const [key] = useTimeframe();
  const [from, to] = key.split("|");
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (path: string) => `${path}${path.includes("?") ? "&" : "?"}${q}`;
}

export const ui = {
  panel: {
    background: color.surface1,
    borderRadius: radius.surface,
    padding: space[24],
  } as CSSProperties,
  subdued: { color: color.textSecondary } as CSSProperties,
  link: { color: color.textPrimary, textDecoration: "none", fontWeight: 500 } as CSSProperties,
  mono: {
    ...type.mono,
    whiteSpace: "pre-wrap",
    background: color.bgBase,
    color: color.textSecondary,
    borderRadius: radius.chip,
    padding: space[12],
    margin: 0,
    overflowX: "auto",
  } as CSSProperties,
};

export function AppLinkTo({ to, children }: { to: string; children: ReactNode }) {
  const href = useAppHref();
  return (
    <Link to={href(to)} className="lc-link" style={ui.link}>
      {children}
    </Link>
  );
}

export function TimeframeBar() {
  const [key, set] = useTimeframe();
  const [from, to] = key.split("|");
  return (
    <TimeframeSelector
      value={{ from, to }}
      min={`now-${RETENTION_DAYS}d`}
      max="now"
      onChange={(v) => v && set(v.from.value, v.to.value)}
      aria-label="Timeframe"
    >
      <TimeframeSelector.Presets>
        {PRESETS.map((p) => (
          <TimeframeSelector.PresetItem key={p.from} value={{ from: p.from, to: "now" }}>
            {p.label}
          </TimeframeSelector.PresetItem>
        ))}
      </TimeframeSelector.Presets>
    </TimeframeSelector>
  );
}

export type QueryRecords = ReadonlyArray<Record<string, unknown> | null>;

/** Error kinds; each has its own plain message. */
export type ErrorKind = "forbidden" | "timeout" | "throttled" | "failed";

export function classifyError(error: Error | null | undefined): ErrorKind | null {
  if (!error) return null;
  const text = `${error.name} ${error.message}`.toLowerCase();
  if (text.includes("not_authorized") || text.includes("forbidden") || text.includes("403")) return "forbidden";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("took too long")) return "timeout";
  if (text.includes("429") || text.includes("too many") || text.includes("throttl") || text.includes("rate limit")) return "throttled";
  return "failed";
}

/** A short code a person can quote to support, derived from the query and the time. */
export function supportCode(query: string, at = Date.now()): string {
  let h = 0;
  for (let i = 0; i < query.length; i++) h = (h * 31 + query.charCodeAt(i)) >>> 0;
  return `LCE-${at.toString(36).slice(-5).toUpperCase()}-${h.toString(36).slice(0, 4).toUpperCase()}`;
}

/** Record cap per query. Reaching it means the result may be partial. */
export const MAX_RESULT_RECORDS = 10000;
/**
 * Cap for queries that return one compact row per entity (host, namespace,
 * application, monitor, bucket): far beyond any realistic environment.
 */
export const ENTITY_RESULT_RECORDS = 100000;

/**
 * Refresh: a counter the header's Refresh button increments. Queries re-run
 * (bypassing the cache) when it changes. There is no polling.
 */
export const RefreshContext = createContext<{ token: number; refresh: () => void }>({
  token: 0,
  refresh: () => undefined,
});

/**
 * The one way this app reads data: live Grail through useDql. Results are
 * cached for 30 minutes (no polling, no auto-refresh); they refresh on mount
 * when stale, on timeframe change and on the Refresh button. Every query has
 * an explicit record cap and a moderate scan limit, and the hook reports a
 * partial result when the cap is reached or Grail says a limit was hit.
 */
export type QueryWindow = { fromIso: string; toIso: string; fetchToIso: string };

/** A fixed window (Reconcile, contract rates): fetch to 24 h past the end, never past now. */
export function fixedWindow(start: string, end: string): QueryWindow {
  return { fromIso: start, toIso: end, fetchToIso: new Date(Math.min(Date.parse(end) + 86400000, Math.floor(Date.now() / 60000) * 60000)).toISOString() };
}

/**
 * Queries showing the previous result while a new one runs:
 * the header says "Updating" and the content dims until every one has arrived.
 */
const staleQueries = new Set<symbol>();
const staleListeners = new Set<() => void>();
const notifyStale = () => staleListeners.forEach((l) => l());
export function useAnyUpdating(): boolean {
  return useSyncExternalStore(
    (l) => {
      staleListeners.add(l);
      return () => staleListeners.delete(l);
    },
    () => staleQueries.size > 0,
  );
}

export function useBillingQuery(template: string, options: { enabled?: boolean; maxRecords?: number; window?: QueryWindow } = {}) {
  const cap = options.maxRecords ?? MAX_RESULT_RECORDS;
  const { token } = useContext(RefreshContext);
  const screenPeriod = usePeriod();
  // A screen's own window (Reconcile's closed days) wins over the timeframe in the URL.
  const period = options.window ?? screenPeriod;
  const filled = fillPeriod(template, period)
    // Daily bins start at midnight in the user's time zone: shift timestamps before bin().
    .split("{DAY_SHIFT}").join(dayShiftDql());
  // Environments without classic entity tables take names from Smartscape, or go without.
  const entityMode = useEntityMode();
  const query = forEntityMode(filled, entityMode);
  const { data, error, isLoading: loadingNow, forceRefetch, cancel: cancelDql } = useDql(
    { query, maxResultRecords: cap, defaultScanLimitGbytes: 100 },
    // runInBackground: by default the hook cancels running queries when the tab is hidden, and a
    // cancelled query ends with no data and no error, which screens read as "nothing billed".
    { enabled: options.enabled ?? true, staleTime: 30 * 60 * 1000, runInBackground: true },
  );
  // The last result of this same template (only the period differs): shown, dimmed, while
  // the new period loads, instead of blanking the screen.
  const last = useRef<{ template: string; records: QueryRecords } | null>(null);
  if (data?.records) last.current = { template, records: data.records };
  const stale = loadingNow && !error && last.current?.template === template && last.current.records !== data?.records;
  const records: QueryRecords | undefined = data?.records ?? (stale ? last.current?.records : undefined);
  const isLoading = loadingNow && !stale;
  const staleId = useRef(Symbol("query"));
  useEffect(() => {
    const id = staleId.current;
    if (stale) staleQueries.add(id);
    else staleQueries.delete(id);
    notifyStale();
    return () => {
      staleQueries.delete(id);
      notifyStale();
    };
  }, [stale]);
  // Cancel (offered after 10 s): stops the query; the section then says so and offers Retry.
  const [cancelledQuery, setCancelledQuery] = useState<string | null>(null);
  const cancelled = cancelledQuery === query && !data;
  const cancel = () => {
    setCancelledQuery(query);
    void cancelDql();
  };
  const retry = () => {
    setCancelledQuery(null);
    void forceRefetch();
  };

  // Self-cost log: one entry per result received.
  const { pathname } = useLocation();
  useEffect(() => {
    if (!data) return;
    logQuery({
      path: pathname,
      at: Date.now(),
      scannedBytes: Number(data.metadata?.grail?.scannedBytes ?? 0) || 0,
      records: data.records.length,
      query,
    });
    // Only a new result should be logged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const firstToken = useRef(token);
  useEffect(() => {
    if (token !== firstToken.current && (options.enabled ?? true)) void forceRefetch();
    // Only the refresh token should trigger this; forceRefetch identity is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const notifications = (data?.metadata?.grail?.notifications ?? []).map((n) => n.message ?? "");
  const partial =
    (records?.length ?? 0) >= cap ||
    notifications.some((m) => /limit|truncat|sampl|incomplete/i.test(m));
  // Failed only because of where names come from (no classic tables, or no Smartscape access):
  // the app moves one step down, and every query re-runs (its text changes, so useDql runs it).
  const missingClassic = entityMode === "classic" ? isMissingClassicError(error, query) : entityMode === "smartscape" && isSmartscapeError(error, query);
  useEffect(() => {
    if (missingClassic) noteEntityError(error, query);
    // Only a change in the cause matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingClassic]);
  // Safety net: a query that ends with neither data nor an error (cancelled by something other
  // than the Cancel button) is run once more; if it ends that way again it is reported as failed,
  // so no screen can read a missing answer as "nothing billed".
  const enabled = options.enabled ?? true;
  const noAnswer = enabled && !loadingNow && !error && !data && !cancelled && !missingClassic;
  const retriedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!noAnswer || retriedFor.current === query) return;
    retriedFor.current = query;
    void forceRefetch();
    // Only a new "no answer" for this query matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noAnswer, query]);
  const gaveUp = noAnswer && retriedFor.current === query;
  const noAnswerError = useMemo(() => (gaveUp ? new Error("The query ended without an answer (no result and no error).") : null), [gaveUp]);
  const errorKind = classifyError(error);
  return { query, records, error: cancelled || missingClassic ? null : error ?? noAnswerError, errorKind: errorKind ?? (noAnswerError ? "failed" : null), isLoading: (isLoading || missingClassic || (noAnswer && !gaveUp)) && !cancelled, retry, partial, notifications, stale, cancel, cancelled };
}

function StatePanel({
  title,
  next,
  query,
  retry,
}: {
  title: string;
  next?: string;
  query: string;
  retry?: () => void;
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <h2 style={{ margin: 0, ...type.heading  }}>{title}</h2>
      {next && <span style={{ ...type.body, color: color.textSecondary }}>{next}</span>}
      {retry && (
        <div>
          <SecondaryButton onClick={retry}>Retry</SecondaryButton>
        </div>
      )}
      {/* Failures show the query (it is what to check); an empty result folds it. */}
      {retry || next ? (
        <>
          <pre style={ui.mono}>{query}</pre>
          <OpenQuery query={query} />
        </>
      ) : (
        <details className="lc-details">
          <summary style={{ ...type.body, color: color.textSecondary }}>Show the query that returned nothing</summary>
          <pre style={{ ...ui.mono, marginTop: space[12] }}>{query}</pre>
        </details>
      )}
    </Card>
  );
}

/**
 * Why a screen is empty, and what to try (v0.12.7). Zero billing records has
 * a few usual causes; each comes with the thing to check, and the most common
 * fix (a longer timeframe) is one click.
 */
function EmptyHelp({ title }: { title: string }) {
  const [tf, setTf] = useTimeframe();
  const longest = /now-(365d|1y)/.test(tf.split("|")[0]);
  // empty screen had no h1); beside other results it stays a section heading.
  const card = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<"h1" | "h2">("h2");
  useLayoutEffect(() => {
    const main = card.current?.closest("main");
    if (main && !main.querySelector("h1")) setLevel("h1");
  }, []);
  const Heading = level;
  return (
    <div ref={card}>
    <Card style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
      <Heading style={{ margin: 0, ...type.heading }}>{title}</Heading>
      <div style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
        <span style={{ ...type.label, color: color.textTertiary }}>Usual reasons, and what to do</span>
        <ul style={{ margin: 0, paddingLeft: space[24], display: "flex", flexDirection: "column", gap: space[8], ...type.body, color: color.textSecondary }}>
          <li>
            <strong style={{ color: color.textPrimary, fontWeight: 500 }}>Nothing was used in this timeframe.</strong> Some capabilities bill
            rarely, and billing records arrive a few hours late. Try a longer timeframe.
          </li>
          <li>
            <strong style={{ color: color.textPrimary, fontWeight: 500 }}>This capability isn't used or isn't in your subscription.</strong>{" "}
            Account Management, under Subscription, lists what your subscription includes. If it isn't there, an empty screen is correct.
          </li>
          <li>
            <strong style={{ color: color.textPrimary, fontWeight: 500 }}>Other screens are empty too.</strong> Your user may be missing the Read
            System Events policy, or this environment isn't on a Dynatrace Platform Subscription. Your Dynatrace admin can check both.
          </li>
        </ul>
      </div>
      {!longest && (
        <div>
          <SecondaryButton onClick={() => setTf("now-365d", "now")}>Show the last 365 days</SecondaryButton>
        </div>
      )}
    </Card>
    </div>
  );
}

/** " + 480m" for Kuala Lumpur, "" for UTC: added to a timestamp before bin(..., 24h). */
export function dayShiftDql(): string {
  const m = dayShiftMinutes();
  return m === 0 ? "" : ` ${m > 0 ? "+" : "-"} ${Math.abs(m)}m`;
}

/** Asks before the browser tab closes or reloads while edits are unsaved. */
export function useWarnUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      // preventDefault is the standard way to ask the browser to confirm leaving.
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

/** A placeholder block for skeletons. Sized by the caller to match the final layout. */
export function Bone({ w, h, r = radius.chip, style }: { w: number | string; h: number; r?: number; style?: CSSProperties }) {
  return <span aria-hidden="true" className="lc-skeleton" style={{ display: "block", width: w, height: h, borderRadius: r, ...style }} />;
}

/** Generic skeleton: a title line, a lead line and three content rows. */
export function DefaultSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
      <Bone w="55%" h={38} />
      <Bone w="70%" h={20} />
      <div style={{ display: "flex", flexDirection: "column", gap: space[8], marginTop: space[16] }}>
        {[0, 1, 2].map((i) => (
          <Bone key={i} w="100%" h={48} r={radius.surface} />
        ))}
      </div>
    </div>
  );
}

/** The section 8 message for each failure kind: what happened, why, what to do. */
/** Dynatrace's own reason for a failure, one sentence, or nothing when it gave none. */
function causeText(error?: Error | null): string {
  const m = (error?.message ?? "").replace(/\s+/g, " ").trim();
  if (!m || /^(failed|error|unknown error)\.?$/i.test(m)) return "";
  const first = m.split(/(?<=\.)\s/)[0];
  return `Dynatrace said: "${first.length > 160 ? `${first.slice(0, 157)}…` : first}" `;
}

export function failureMessage(kind: ErrorKind, query: string, error?: Error | null): { title: string; next?: string; retry: boolean } {
  switch (kind) {
    case "forbidden":
      return {
        title:
          MSG.noPermissionTitle,
        next: MSG.noPermissionNext,
        retry: false,
      };
    case "timeout":
      return { title: "This is taking too long.", next: "Choose a shorter period or try again.", retry: true };
    case "throttled":
      return { title: "Dynatrace is busy right now.", next: "Wait a minute and try again.", retry: true };
    default:
      return {
        title: "This section couldn't load.",
        // The cause, in Dynatrace's own words when it gave one, then what to do.
        next: `${causeText(error)}Try again. The rest of the app still works; if this keeps failing, share support code ${supportCode(query)} with whoever looks after this app.`,
        retry: true,
      };
  }
}

/**
 * Renders loading, failure and empty states for a query, or the children when
 * there are records. Never conflated, never rendered as a number:
 *   loading        skeleton sized like the final layout
 *   failed         forbidden / timeout / throttled / failed (section 8)
 *   no result      nothing came back at all; not the same as no records
 *   zero records   one plain sentence for the period
 *   partial        children render under an "at least" notice
 */
/**
 * Loading in three steps: under a second shows nothing
 * (the space is kept, so nothing jumps); one to ten seconds shows the skeleton;
 * after ten seconds a plain sentence says the query is still running.
 */
function LoadingGate({ children, onCancel }: { children: ReactNode; onCancel?: () => void }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setStage(1), 1000);
    const b = window.setTimeout(() => setStage(2), 10000);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  return (
    <div aria-busy="true">
      {stage === 2 && (
        <p role="status" style={{ ...type.body, color: color.textSecondary, margin: `0 0 ${space[8]}px`, display: "flex", alignItems: "center", gap: space[12], flexWrap: "wrap" }}>
          {MSG.stillRunning}
          {onCancel && <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>}
        </p>
      )}
      <div style={{ visibility: stage === 0 ? "hidden" : "visible" }}>{children}</div>
    </div>
  );
}

export function QueryOutcome({
  query,
  records,
  error,
  errorKind,
  isLoading,
  retry,
  partial,
  skeleton,
  empty,
  cancel,
  cancelled,
  children,
}: {
  query: string;
  records: QueryRecords | undefined;
  error: Error | undefined | null;
  errorKind?: ErrorKind | null;
  isLoading: boolean;
  retry?: () => void;
  partial?: boolean;
  /** Skeleton matching the final layout. Defaults to a generic one. */
  skeleton?: ReactNode;
  /** One plain sentence saying what zero records means on this screen. */
  empty?: string;
  /** Offered after 10 s of loading; `cancelled` then shows a plain notice with Retry. */
  cancel?: () => void;
  cancelled?: boolean;
  children: ReactNode;
}) {
  const [tf] = useTimeframe();
  if (cancelled) {
    return <StatePanel title={MSG.cancelledTitle} next={MSG.cancelledNext} query={query} retry={retry} />;
  }
  if (isLoading) {
    return <LoadingGate onCancel={cancel}>{skeleton ?? <DefaultSkeleton />}</LoadingGate>;
  }
  if (error) {
    const m = failureMessage(errorKind ?? classifyError(error) ?? "failed", query, error);
    return <StatePanel title={m.title} next={m.next} query={query} retry={m.retry ? retry : undefined} />;
  }
  if (!records) {
    return (
      <StatePanel
        title="No result came back. This is not the same as no records."
        next="Retry to run the same query again."
        query={query}
        retry={retry}
      />
    );
  }
  if (records.length === 0) {
    return <EmptyHelp title={empty ?? `No billed usage recorded for ${periodPhrase(tf)}.`} />;
  }
  return (
    <>
      {partial && (
        <div role="status" style={{ ...ui.panel, padding: space[16], display: "flex", flexDirection: "column", gap: space[4] }}>
          <span style={{ ...type.heading }}>Figures may be incomplete.</span>
          <span style={{ ...type.body, color: color.textSecondary }}>
            The query reached its data limit. Totals shown are at least this much.
          </span>
        </div>
      )}
      {children}
    </>
  );
}

/**
 * Freshness: when the newest billing record in the result was written.
 * Billing records lag up to 24 hours, so the newest day is still arriving.
 */
export function DataAsOf({ last }: { last: string | null }) {
  if (!last) return null;
  const when = new Date(last);
  if (Number.isNaN(when.getTime())) return null;
  // Billing records arrive within about a day. An older newest record means nothing newer was billed,
  // not that it is still on its way.
  const stale = Date.now() - when.getTime() > 36 * 3600 * 1000;
  return (
    <span style={{ ...type.body, color: color.textTertiary }}>
      {stale
        ? `Newest record: ${formatMoment(when)}. Nothing of this kind was billed after that.`
        : `Data as of ${formatMoment(when)}. Newer billing events haven't arrived yet; the most recent day is still arriving.`}
    </span>
  );
}

/** Collapsible "how this was computed" block. */
/**
 * "Open this query in Dynatrace" (v0.12.19): the platform's built-in dt.query
 * intent, so Dynatrace offers the apps that take a query (Notebooks, Dashboards)
 * and opens it there, filled in. The sceptic's answer to "where does this
 * number come from?" is one click: the same query, ready to explore.
 */
export function OpenQuery({ query }: { query: string }) {
  // Only a single query opens: a box holding several (Findings') would not run as one.
  if ((query.match(/^\s*fetch\s/gm) ?? []).length !== 1) return null;
  return (
    <SecondaryButton onClick={() => sendIntent({ "dt.query": query })} style={{ alignSelf: "flex-start" }}>
      Open this query in Dynatrace
    </SecondaryButton>
  );
}

export function ShowQuery({ query }: { query: string }) {
  return (
    <details className="lc-details">
      <summary style={{ ...type.body, color: color.textTertiary, cursor: "pointer" }}>
        Show the query behind this
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: space[8], marginTop: space[8] }}>
        <pre style={{ ...ui.mono, margin: 0 }}>{query}</pre>
        <OpenQuery query={query} />
      </div>
    </details>
  );
}

export function PageTitle({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
      <Headline>
        <span style={{ color: color.textPrimary, fontFamily: font.sans }}>{title}</span>
      </Headline>
      {lead && <p style={{ margin: 0, ...type.bodyLarge, color: color.textSecondary }}>{lead}</p>}
    </div>
  );
}

export const asNumber = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The way back from a screen one level below the sidebar (v0.12.11): one quiet
 * "‹ Parent" link, like the back button in an iPhone app. Top-level screens are
 * reached from the sidebar and show nothing here. Links carry the timeframe.
 */
/** The previous in-app screen, so a "‹ Parent" link can go back to it exactly as it was. */
let previousPath: string | null = null;
let currentPath: string | null = null;
export function trackPath(pathname: string) {
  if (pathname !== currentPath) {
    previousPath = currentPath;
    currentPath = pathname;
  }
}

export function Crumbs({ trail }: { trail: { label: string; to?: string }[] }) {
  const navigate = useNavigate();
  const parent = [...trail].reverse().find((c) => c.to);
  if (!parent?.to) return null;
  const parentPath = parent.to.split("?")[0];
  // Came from the parent: go back, so its filters, grouping, sort and scroll return as they were.
  const cameFromParent = previousPath === parentPath;
  if (cameFromParent) {
    return (
      <button type="button" className="lc-link" onClick={() => navigate(-1)} style={{ ...ui.link, background: "transparent", border: 0, padding: 0, cursor: "pointer", alignSelf: "flex-start" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[4], ...type.body, color: color.textSecondary }}>
          <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" style={{ flex: "none" }}>
            <path d="M6.5 1 1.5 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {parent.label}
        </span>
      </button>
    );
  }
  return (
    <AppLinkTo to={parent.to}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: space[4], ...type.body, color: color.textSecondary }}>
        <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" style={{ flex: "none" }}>
          <path d="M6.5 1 1.5 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {parent.label}
      </span>
    </AppLinkTo>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <span style={{ ...type.label, color: color.textTertiary }}>{label}</span>
      <span style={{ ...type.title, wordBreak: "break-word" }}>{value}</span>
      {note && <span style={{ ...type.body, color: color.textSecondary }}>{note}</span>}
    </Card>
  );
}
