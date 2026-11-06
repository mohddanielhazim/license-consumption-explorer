import React, { useMemo, type CSSProperties } from "react";
import { BarTip, useBarHover } from "../components/BarHover";
import { Link } from "react-router-dom";

import { color, radius, space, type, layout } from "../design/tokens";
import { Answer } from "../design/primitives";
import { Bone, DataAsOf, QueryOutcome, ShowQuery, useAppHref, usePeriod } from "../components/shared";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { nativeDisplay, type Capability, capabilityLabel } from "../capabilities";
import { quantityOf, quantitySums } from "../funnel";
import { formatQuantity } from "../rates";
import { R } from "../routes";
import { startsMidDay, stillArriving, utcDaysBetween } from "../data/math";
import { NOT_CHARGED } from "../data/listPrices";
import { dayShiftMinutes, zoneLabel, formatDay } from "../locale";
import { appLocale }  from "../locale";

import { NextSteps } from "../components/NextSteps";
/**
 * Usage by capability: every capability the tenant bills, its native total
 * and a daily trend. One query (after discovery): daily sums per type, whose
 * total is the period total. Records are dated by the usage they describe:
 * usage.start where present, else event.start (workflows), query_start
 * (queries), else the record timestamp. Days run midnight to midnight in the user's time zone.
 */
export const usageQuery = (fields: string[]) => `fetch dt.system.events, from: {TIMEFRAME_PADDED}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
| fieldsAdd usage_time = coalesce(toTimestamp(usage.start), toTimestamp(event.start), toTimestamp(query_start), timestamp)
| filter usage_time >= toTimestamp("{FROM}") and usage_time < toTimestamp("{TO}")
| fieldsAdd usage_day = bin(usage_time{DAY_SHIFT}, 24h)
| summarize ${quantitySums(fields, ["last_record = max(timestamp)"])},
    by:{event.type, usage_day}`;

type Row = {
  eventType: string;
  cap: Capability;
  total: number | null;
  records: number;
  days: Map<string, number>;
};

const FAMILIES = [
  "Hosts, containers and pods",
  "Digital experience",
  "Data ingest",
  "Data retention",
  "Queries",
  "Automation and apps",
  "Other",
] as const;

function family(r: Row): (typeof FAMILIES)[number] {
  const t = r.eventType;
  if (r.cap.discovered) return "Other";
  if (t.endsWith(" - Query")) return "Queries";
  if (t.includes("Retain")) return "Data retention";
  if (t.includes("Ingest")) return "Data ingest";
  if (r.cap.linkedTo === "application" || r.cap.linkedTo === "monitor") return "Digital experience";
  if (r.cap.linkedTo === "host" || r.cap.linkedTo === "namespace") return "Hosts, containers and pods";
  if (t === "Automation Workflow" || t.startsWith("AppEngine")) return "Automation and apps";
  return "Other";
}

/** Where a capability's entities are shown, if the app has that screen. */
function detailPath(r: Row): string | null {
  if (r.cap.detail === "hosts") return R.entities("hosts");
  if (r.cap.detail === "kubernetes") return R.entities("kubernetes");
  if (r.cap.linkedTo === "application") return R.entities("applications");
  if (r.cap.linkedTo === "monitor") return R.entities("monitors");
  if (/Ingest|Retain/.test(r.eventType) && !r.cap.discovered) return R.entities("buckets");
  return null;
}



export const Usage = () => {
  const { query, records, error, errorKind, partial, isLoading, retry, cancel, cancelled, resolve } = useMeasuredQuery(usageQuery);
  const href = useAppHref();
  const period = usePeriod();
  const phrase = period.phrase;
  const dayKeys = useMemo(() => utcDaysBetween(period.fromIso, period.toIso, dayShiftMinutes()), [period.fromIso, period.toIso]);
  const partialFirst = startsMidDay(period.fromIso, dayShiftMinutes());

  const { rows, last } = useMemo(() => {
    const byType = new Map<string, Row>();
    let newest: string | null = null;
    for (const r of records ?? []) {
      if (!r) continue;
      const eventType = String(r["event.type"]);
      const cap = resolve(eventType);
      const q = quantityOf(r, cap);
      const row = byType.get(eventType) ?? { eventType, cap, total: null, records: 0, days: new Map<string, number>() };
      row.records += Number(r.records) || 0;
      if (q !== null) {
        row.total = (row.total ?? 0) + q;
        const day = typeof r.usage_day === "object" && r.usage_day !== null ? (r.usage_day as { start?: string }).start : r.usage_day;
        if (typeof day === "string") {
          const key = day.slice(0, 10);
          row.days.set(key, (row.days.get(key) ?? 0) + q);
        }
      }
      byType.set(eventType, row);
      if (typeof r.last_record === "string" && (!newest || r.last_record > newest)) newest = r.last_record;
    }
    return { rows: [...byType.values()], last: newest };
  }, [records, resolve]);

  const units = new Set(rows.map((r) => r.cap.nativeUnit));
  const n = rows.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome
        query={query}
        records={records}
        error={error}
        errorKind={errorKind}
        partial={partial}
        isLoading={isLoading}
        retry={retry} cancel={cancel} cancelled={cancelled}
        skeleton={<UsageSkeleton />}
        empty={`No billed usage recorded for ${phrase}.`}
      >
        <Answer
          setup={`${n} ${n === 1 ? "capability was" : "capabilities were"} billed`}
          conclusion={`in ${units.size} different ${units.size === 1 ? "unit" : "units"}.`}
          lead="Each capability is measured in its own unit, so they can't be ranked against each other without a rate card. Open one to see what drives it."
        />
        <DataAsOf last={last} />
        <span style={{ ...type.body, color: color.textTertiary }}>
          Bars show usage per day ({zoneLabel()}) for {phrase}, each on its own scale. Days in the last 24 hours are still
          arriving and are drawn in outline.
        </span>
        {FAMILIES.map((f) => {
          const inFamily = rows.filter((r) => family(r) === f).sort((a, b) => a.eventType.localeCompare(b.eventType));
          if (inFamily.length === 0) return null;
          return (
            <section key={f} style={{ display: "flex", flexDirection: "column" }} aria-label={f}>
              <h2 style={{ margin: 0, ...type.heading, paddingBottom: space[8]  }}>{f}</h2>
              {inFamily.map((r) => {
                const to = detailPath(r);
                const content = (
                  <>
                    <span style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
                      {/* The name is the link, stretched over the row (lc-stretch): the whole row still
                          opens it, and the chart's data table stays out of the link's name. */}
                      {to ? (
                        <Link to={href(to)} className="lc-stretch" style={{ ...type.heading, color: color.textPrimary, textDecoration: "none" }}>
                          {capabilityLabel(r.eventType)}
                        </Link>
                      ) : (
                        <span style={{ ...type.heading, color: color.textPrimary }}>{capabilityLabel(r.eventType)}</span>
                      )}
                      <span style={{ ...type.body, color: color.textSecondary }}>
                        {r.total === null
                          ? `${r.records.toLocaleString(appLocale())} billing records, no quantity field`
                          : `${formatQuantity(nativeDisplay(r.cap, r.total))} ${r.cap.nativeUnit}`}
                        {r.cap.discovered && r.total !== null ? " (unit read from the field name, not verified)" : ""}
                        {NOT_CHARGED[r.eventType] ? `, ${NOT_CHARGED[r.eventType]}` : ""}
                      </span>
                    </span>
                    <Trend days={dayKeys} values={r.days} cap={r.cap} label={r.eventType} partialFirst={partialFirst} />
                    <span aria-hidden={to ? "true" : undefined} style={{ ...type.body, color: color.textTertiary, textAlign: "right", whiteSpace: "nowrap" }}>
                      {to ? "›" : ""}
                    </span>
                  </>
                );
                return (
                  <div key={r.eventType} className={to ? "lc-row" : undefined} style={row}>
                    {content}
                  </div>
                );
              })}
            </section>
          );
        })}
      </QueryOutcome>
      <NextSteps links={[{ to: R.entities("hosts"), label: "See which hosts and namespaces drive it" }, { to: R.spend, label: "See what it costs" }]} />
      <ShowQuery query={query} />
    </div>
  );
};

const row: CSSProperties = {
  display: "grid",
  // Minimums fit the 1024 px window (content 672 px); wider windows grow the trend.
  gridTemplateColumns: "minmax(220px, 1fr) minmax(200px, 2.4fr) 72px",
  gap: space[24],
  alignItems: "center",
  padding: `${space[12]}px ${space[8]}px`,
  borderTop: `1px solid ${color.line}`,
  borderRadius: radius.chip,
  position: "relative",
};

/**
 * Small daily bars, no gridlines or axis labels. Each capability on its own
 * zero-based scale. A day with no records leaves an empty slot (not a zero);
 * today is drawn in outline because it is still arriving.
 */
function Trend({ days, values, cap, label, partialFirst }: { days: string[]; values: Map<string, number>; cap: Capability; label: string; partialFirst: boolean }) {
  const shown = days.map((d) => (values.has(d) ? nativeDisplay(cap, values.get(d) ?? 0) : null));
  const max = Math.max(0, ...shown.map((v) => v ?? 0));
  const billedDays = shown.filter((v) => v !== null).length;
  const peakIndex = shown.reduce<number>((best, v, i) => ((v ?? -1) > (shown[best] ?? -1) ? i : best), 0);
  const hover = useBarHover(days.length);
  const hv = hover.index === null ? undefined : shown[hover.index];
  return (
    // One grid cell: the chart and its hidden value table stay together.
    <span style={{ display: "block", minWidth: 0 }}>
    <span
      role="img"
      aria-label={`${label}: daily usage, billed on ${billedDays} of ${days.length} days`}
      {...hover.handlers}
      style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 2, height: 32 }}
    >
      {hover.index !== null && (
        <BarTip index={hover.index} count={days.length}>
          {formatDay(days[hover.index])}: {hv === null || hv === undefined ? "no records" : `${formatQuantity(hv)} ${cap.nativeUnit}`}
          {partialFirst && hover.index === 0 ? " (part of a day)" : stillArriving(days[hover.index], Date.now(), dayShiftMinutes()) ? " (still arriving)" : ""}
        </BarTip>
      )}
      {shown.map((v, i) => {
        // Outlined, as on Spend: a day still arriving, or a first day that holds only a few hours.
        const today = stillArriving(days[i], Date.now(), dayShiftMinutes()) || (partialFirst && i === 0);
        const h = v === null || max === 0 ? 0 : Math.max((v / max) * 100, v > 0 ? 6 : 0);
        return (
          <span
            key={days[i]}
            style={{
              flex: 1,
              height: `${h}%`,
              minHeight: v ? 1 : 0,
              boxSizing: "border-box",
              background: today ? "transparent" : i === peakIndex && max > 0 ? color.textPrimary : i === hover.index ? color.textSecondary : color.lineStrong,
              border: today && v !== null ? `1px solid ${color.lineStrong}` : "none",
              borderRadius: 1,
            }}
          />
        );
      })}
    </span>
    {/* The same values for keyboard and screen-reader users (the hover labels are mouse-only). */}
    <span className="lc-visually-hidden">
    <table>
      <caption>{label}: usage per day</caption>
      <tbody>
        {days.map((d, i) => (
          <tr key={d}>
            <th scope="row">{formatDay(d)}</th>
            <td>{shown[i] === null ? "no records" : `${formatQuantity(shown[i] ?? 0)} ${cap.nativeUnit}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </span>
    </span>
  );
}

function UsageSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
        <Bone w="85%" h={38} />
        <Bone w="70%" h={24} />
      </section>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Bone w={200} h={22} style={{ marginBottom: space[8] }} />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={row}>
            <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
              <Bone w="70%" h={22} />
              <Bone w="45%" h={20} />
            </span>
            <Bone w="100%" h={32} r={2} />
            <Bone w={60} h={20} style={{ justifySelf: "end" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
