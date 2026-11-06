import React, { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { color, radius, space, type, layout } from "../design/tokens";
import { Answer } from "../design/primitives";
import { Bone, DataAsOf, QueryOutcome, ShowQuery, useAppHref, type ErrorKind, type QueryRecords } from "./shared";
import { formatQuantity } from "../rates";
import { EntityIdLine, disambiguate } from "./EntityName";
import { Info, type Guide } from "./Info";
import { TextButton } from "../design/primitives";
import { appLocale } from "../locale";
import { GLOSSARY } from "../data/glossary";

/** The "i" on a ranked list's unit column: the glossary meaning plus where the figure comes from. */
const UNIT_TERM: Record<string, string> = {
  "GiB-hours": "GiB-hour",
  "host-hours": "Host-hour",
  "pod-hours": "Pod-hour",
  "container-hours": "Container-hour",
  sessions: "Session",
  "synthetic actions": "Synthetic action / request",
  "synthetic requests": "Synthetic action / request",
  "GiB scanned": "Query",
};
function unitGuide(unit: string): Guide {
  const term = UNIT_TERM[unit];
  const meaning = GLOSSARY.find((g) => g.term === term)?.meaning;
  return {
    what: meaning ?? `Billed ${unit}.`,
    how: "Summed from billing usage events in the chosen timeframe, each record counted once (deduplicated by event id).",
    where: "dt.system.events, event.kind BILLING_USAGE_EVENT: Dynatrace billing usage events.",
    when: "Records arrive up to 24 hours late, so the newest day reads low.",
  };
}

export type RankedItem = {
  id: string;
  name: string;
  /** Second line: what kind of thing it is, never a raw id. */
  detail?: string;
  /** The entity id: shown on hover and copyable, never as the label. */
  entityId?: string;
  /** Short text added to the name when another row has the same name (e.g. host group). */
  disambiguator?: string;
  value: number;
  /** In-app path for the row's drill-down. */
  to?: string;
  /** Third line: other capabilities billed to the same entity, already worded. */
  extras?: string;
};

/**
 * "N of M account for X%" from live values: the fewest top items whose
 * cumulative share reaches 80%, and their exact share. Computed, never written.
 */
export function concentration(values: number[]): { n: number; total: number; share: number } {
  const sorted = [...values].sort((a, b) => b - a);
  const sum = sorted.reduce((a, b) => a + b, 0);
  let acc = 0;
  let n = 0;
  for (const v of sorted) {
    acc += v;
    n += 1;
    if (sum > 0 && acc / sum >= 0.8) break;
  }
  return { n, total: sorted.length, share: sum > 0 ? acc / sum : 0 };
}

/**
 * The two-tone answer for a ranked list, from live values:
 * "5 of 13 hosts | account for 92% of Full-Stack usage."
 */
export function concentrationAnswer(
  values: number[],
  noun: { one: string; many: string },
  measure: string,
): [string, string] {
  const { n, total, share } = concentration(values);
  // Never round a partial share up to "100%" (or a real one down to "0%").
  const pct =
    share < 1 && Math.round(share * 100) === 100
      ? "over 99%"
      : share > 0 && Math.round(share * 100) === 0
        ? "under 1%"
        : `${Math.round(share * 100)}%`;
  // Every value zero: nothing to rank, so say so instead of "spread across all N" (sweep, Kubernetes).
  if (total > 0 && values.every((v) => v === 0)) return [`No ${measure}`, `${/s$/.test(measure.split(" ").pop() ?? "") ? "were" : "was"} billed to the ${total.toLocaleString(appLocale())} ${noun.many} in this timeframe.`];
  if (total === 1) return [`One ${noun.one}`, `accounts for all ${measure}.`];
  if (n === total) return [`${measure[0].toUpperCase()}${measure.slice(1)} is spread across`, `all ${total.toLocaleString(appLocale())} ${noun.many}.`];
  return [`${n.toLocaleString(appLocale())} of ${total.toLocaleString(appLocale())} ${noun.many}`, `${n === 1 ? "accounts" : "account"} for ${pct} of ${measure}.`];
}

/**
 * One ranked list: one measure, sorted descending, an inline bar on a shared
 * zero-based scale (the largest value is the full width). Rows link to their
 * drill-down. States come from QueryOutcome: skeleton rows while loading,
 * "no result came back" with Retry, and a plain sentence for zero records.
 */
export function RankedList({
  query,
  records,
  error,
  errorKind,
  partial,
  last,
  isLoading,
  retry,
  cancel,
  cancelled,
  items,
  setup,
  conclusion,
  lead,
  unit,
  empty,
  itemLabel,
  footnote,
  secondary,
  filters,
  download,
  next,
  delta,
}: {
  query: string;
  records: QueryRecords | undefined;
  error: Error | undefined | null;
  errorKind?: ErrorKind | null;
  partial?: boolean;
  /** Newest billing record in the result, for "Data as of". */
  last?: string | null;
  isLoading: boolean;
  retry: () => void;
  cancel?: () => void;
  cancelled?: boolean;
  items: RankedItem[];
  setup: string;
  conclusion: string;
  lead: string;
  /** Native unit shown after each value, e.g. "GiB-hours". */
  unit: string;
  empty: string;
  /** Column header for the name column, e.g. "Host". */
  itemLabel: string;
  footnote?: ReactNode;
  /** A further section under the rows, e.g. entities ranked by another measure. */
  secondary?: ReactNode;
  /** Filter bar for list screens. */
  filters?: ReactNode;
  /** "Download CSV" for every row that matches the filters (v0.12.7). */
  download?: ReactNode;
  /** Where to go from here (v0.12.8). */
  next?: ReactNode;
  /** The comparison with the previous period, under the headline (v0.12.12). */
  delta?: ReactNode;
}) {
  const href = useAppHref();
  const ranked = items;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome
        query={query}
        records={records}
        error={error}
        errorKind={errorKind}
        partial={partial}
        isLoading={isLoading}
        retry={retry}
        cancel={cancel}
        cancelled={cancelled}
        empty={empty}
        skeleton={<RankedSkeleton />}
      >
        <Answer setup={setup} conclusion={conclusion} lead={lead} delta={delta} />
        <DataAsOf last={last ?? null} />
        {filters}
        {ranked.length === 0 ? (
          <span style={{ ...type.bodyLarge, color: color.textSecondary }}>
            No {itemLabel.toLowerCase()}s match the filters. Remove a filter to see more.
          </span>
        ) : null}
        <RankedRows items={ranked} unit={unit} itemLabel={itemLabel} href={href} />
        {secondary}
        {download}
        {footnote && <span style={{ ...type.body, color: color.textTertiary }}>{footnote}</span>}
      </QueryOutcome>
      {next}
      <ShowQuery query={query} />
    </div>
  );
}

/**
 * Sortable column header (v0.12.8). Lists open ranked, highest first; a click
 * on a header sorts by it and a second click reverses it, as in a spreadsheet.
 */
export type SortState<K extends string> = { by: K; dir: "asc" | "desc" };

/**
 * Sort order kept in the URL as ?sort=<key>.<dir>, so a reload or a shared link
 * shows the same order and Back undoes a change.
 * The default order is left out of the URL.
 */
export function useSortParam<K extends string>(allowed: readonly K[], initial: SortState<K>): [SortState<K>, (s: SortState<K>) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("sort") ?? "";
  const [by, dir] = raw.split(".");
  const sort: SortState<K> = (allowed as readonly string[]).includes(by) && (dir === "asc" || dir === "desc") ? { by: by as K, dir } : initial;
  const set = (s: SortState<K>) => {
    const p = new URLSearchParams(params);
    if (s.by === initial.by && s.dir === initial.dir) p.delete("sort");
    else p.set("sort", `${s.by}.${s.dir}`);
    setParams(p);
  };
  return [sort, set];
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  first = "desc",
  align = "left",
}: {
  label: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  /** Direction on the first click: numbers start high to low, names A to Z. */
  first?: "asc" | "desc";
  align?: "left" | "right";
}) {
  const active = sort.by === sortKey;
  const flip = (d: "asc" | "desc") => (d === "asc" ? "desc" : "asc");
  return (
    <button
      type="button"
      className="lc-sort"
      aria-label={`Sort by ${typeof label === "string" ? label : sortKey}${active ? (sort.dir === "asc" ? ", now ascending" : ", now descending") : ""}`}
      onClick={() => onSort({ by: sortKey, dir: active ? flip(sort.dir) : first })}
      style={{
        ...type.label,
        textTransform: "none",
        letterSpacing: 0,
        color: active ? color.textPrimary : color.textTertiary,
        background: "transparent",
        border: 0,
        padding: 0,
        cursor: "pointer",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: space[4],
        // Text keeps the column edge: the arrow goes after a left-aligned label and before a right-aligned one.
        flexDirection: align === "right" ? "row" : "row-reverse",
      }}
    >
      <span aria-hidden="true" style={{ width: 8, display: "inline-block", textAlign: "center", opacity: active ? 1 : 0 }}>
        {sort.dir === "asc" ? "↑" : "↓"}
      </span>
      {label}
    </button>
  );
}

export function sortBy<T>(rows: T[], sort: SortState<string>, value: (row: T, key: string) => number | string): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, sort.by);
    const y = value(b, sort.by);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
    return sign * c;
  });
}

/** Just the rows: one measure, descending, bars on a shared zero-based scale. */
export function RankedRows({
  items,
  unit,
  itemLabel,
  href,
}: {
  items: RankedItem[];
  unit: string;
  itemLabel: string;
  href: (path: string) => string;
}) {
  const [sort, setSort] = useSortParam(["name", "value"] as const, { by: "value", dir: "desc" });
  const ranked0 = disambiguate([...items].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)));
  const all = sort.by === "value" && sort.dir === "desc" ? ranked0 : sortBy(ranked0, sort, (r, k) => (k === "name" ? r.name : r.value));
  const max = all.reduce((m, r) => Math.max(m, r.value), 0);
  // The answer is at the top: ten rows, then 25 more at a time.
  const pager = usePager(all.length);
  const ranked = all.slice(0, pager.shown);
  return (
        <div role="table" aria-label={`${itemLabel}s ranked by ${unit}`} style={{ display: "flex", flexDirection: "column" }}>
          <div role="row" style={{ ...grid, padding: `0 ${space[8]}px ${space[8]}px` }}>
            <span role="columnheader" aria-sort={sort.by === "name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} style={head}>
              <SortHeader label={itemLabel} sortKey="name" sort={sort} onSort={setSort} first="asc" />
            </span>
            {/* Units keep their own spelling (GiB-hours), so no uppercase here. */}
            <span role="columnheader" aria-sort={sort.by === "value" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} style={{ ...head, textAlign: "right", textTransform: "none", letterSpacing: 0, display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: space[8] }}>
              {/* The (i) sits before the unit, so the unit ends on the numbers' right edge. */}
              <Info label={unit} guide={unitGuide(unit)} />
              <SortHeader label={unit} sortKey="value" sort={sort} onSort={setSort} align="right" />
            </span>
            <span role="columnheader" style={head}>
              <span className="lc-visually-hidden">Share of the largest</span>
            </span>
          </div>
          {ranked.map((item) => {
            const width = max > 0 ? (item.value / max) * 100 : 0;
            const row = (
              <>
                <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
                  {item.to ? (
                    // Stretched over the row (lc-stretch): a row that tints on hover also opens on click.
                    <Link
                      to={href(item.to)}
                      className="lc-stretch"
                      style={{ ...type.heading, color: color.textPrimary, textDecoration: "none", overflowWrap: "anywhere" }}
                    >
                      {item.name}
                    </Link>
                  ) : (
                    <span style={{ ...type.heading, color: color.textPrimary, overflowWrap: "anywhere" }}>{item.name}</span>
                  )}
                  {/* ID and detail share one line (v0.12.32): a host row was three lines, so four fit on a laptop screen.
                      Raised above the stretched link so Copy stays clickable. */}
                  {(item.entityId || item.detail) && (
                    <span style={{ display: "flex", alignItems: "center", gap: `${space[4]}px ${space[12]}px`, flexWrap: "wrap", position: "relative", zIndex: 1, minWidth: 0 }}>
                      {item.detail && <span style={{ ...type.body, color: color.textTertiary }}>{item.detail}</span>}
                      {item.entityId && <EntityIdLine id={item.entityId} />}
                    </span>
                  )}
                  {item.extras && <span style={{ ...type.body, color: color.textSecondary }}>{item.extras}</span>}
                </span>
                <span role="cell" style={{ ...type.body, color: color.textPrimary, textAlign: "right", whiteSpace: "nowrap" }}>
                  {/* Keyed by value: a new figure fades in; an unchanged one stays still. */}
                  <span key={item.value} className="lc-num">{formatQuantity(item.value)}</span>
                </span>
                <span role="cell" aria-hidden="true" style={{ height: 4 }}>
                  <span
                    className="lc-grow"
                    style={{
                      display: "block",
                      height: "100%",
                      // Full width, scaled: the bar slides to a new length without reflowing the row.
                      // A small floor keeps a non-zero value visible (it was a 4 px minimum width).
                      transform: `scaleX(${item.value > 0 ? Math.max(width / 100, 0.006) : 0})`,
                      borderRadius: radius.marker,
                      // One mark in the strong colour: the largest; the rest recede.
                      background: item.value === max && max > 0 ? color.textPrimary : color.lineStrong,
                    }}
                  />
                </span>
              </>
            );
            return (
              <div key={item.id} role="row" data-row="item" className={item.to ? "lc-row" : undefined} style={{ ...grid, ...rowBox, position: "relative" }}>
                {row}
              </div>
            );
          })}
          {pager.needed ? (
            <div role="row" style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[4] }}>
              <span role="cell">
                <PagerFooter pager={pager} noun={`${itemLabel.toLowerCase()}s`} />
              </span>
            </div>
          ) : null}
        </div>
  );
}

/** First rows shown, and how many more each "Show more" adds. */
const FIRST = 10;
const STEP = 25;
/** "Show all" is offered only up to this many rows; beyond it, the name filter is the way to find one. */
const SHOW_ALL_MAX = 200;

export type Pager = { total: number; shown: number; needed: boolean; more: () => void; all: () => void; reset: () => void };

/**
 * Paging for long lists: the first ten, then 25 more at a time. Resets when
 * the list's length changes (a filter was applied), so the count always
 * describes what is on screen.
 */
export function usePager(total: number, first: number = FIRST): Pager {
  const [shown, setShown] = useState(first);
  const [forTotal, setForTotal] = useState(total);
  if (forTotal !== total) {
    setForTotal(total);
    setShown(first);
  }
  const visible = Math.min(shown, total);
  return {
    total,
    shown: visible,
    needed: total > first,
    more: () => setShown((n) => Math.min(total, n + STEP)),
    all: () => setShown(total),
    reset: () => setShown(first),
  };
}

/** "Showing 10 of 100 hosts · Show 25 more · Show all 100" ("Show all 13" alone when the rest fits in one step), or a pointer to the filter for very long lists. */
export function PagerFooter({ pager, noun, filterHint = true }: { pager: Pager; noun: string; filterHint?: boolean }) {
  const remaining = pager.total - pager.shown;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: space[8], flexWrap: "wrap", paddingLeft: space[8] }}>
      <span role="status" aria-live="polite" style={{ ...type.body, color: color.textTertiary, paddingRight: space[8] }}>
        Showing {pager.shown.toLocaleString(appLocale())} of {pager.total.toLocaleString(appLocale())} {noun}
      </span>
      {/* When the rest fits in one step, one button: "Show 3 more" and "Show all" would do the same thing. */}
      {remaining > 0 && remaining <= STEP && <TextButton onClick={pager.all}>Show all {pager.total.toLocaleString(appLocale())}</TextButton>}
      {remaining > STEP && <TextButton onClick={pager.more}>Show {STEP} more</TextButton>}
      {remaining > STEP && pager.total <= SHOW_ALL_MAX && <TextButton onClick={pager.all}>Show all {pager.total.toLocaleString(appLocale())}</TextButton>}
      {remaining === 0 && <TextButton onClick={pager.reset}>Show fewer</TextButton>}
      {remaining > 0 && pager.total > SHOW_ALL_MAX && filterHint && (
        <span style={{ ...type.body, color: color.textTertiary }}>To find a specific one, use the name filter above.</span>
      )}
    </span>
  );
}

const grid: React.CSSProperties = {
  display: "grid",
  // Fixed value column: every row is its own grid, so a content-sized column would differ row to row.
  gridTemplateColumns: "minmax(200px, 1.6fr) 152px minmax(96px, 1.6fr)",
  gap: space[24],
  alignItems: "center",
};

const rowBox: React.CSSProperties = {
  // 8 px inside the hover tint: text never touches the tint's edge.
  padding: `${space[12]}px ${space[8]}px`,
  borderTop: `1px solid ${color.line}`,
  borderRadius: radius.chip,
};

const head: React.CSSProperties = { ...type.label, color: color.textTertiary };

/** Loading: answer lines plus rows with the same height as loaded rows. */
function RankedSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
        <Bone w="80%" h={38} />
        <Bone w="60%" h={24} />
      </section>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Bone w={120} h={16} style={{ marginBottom: space[8] }} />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ ...grid, ...rowBox }}>
            <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
              <Bone w="70%" h={22} />
              <Bone w="45%" h={16} />
            </span>
            <Bone w={72} h={20} style={{ justifySelf: "end" }} />
            <Bone w={`${90 - i * 10}%`} h={space[8]} r={radius.marker} />
          </div>
        ))}
      </div>
    </div>
  );
}
