import React, { useMemo } from "react";
import { appLocale } from "../locale";
import { Link, useNavigate } from "react-router-dom";

import { color, space, type } from "../design/tokens";
import { Answer, PrimaryButton } from "../design/primitives";
import { ENTITY_RESULT_RECORDS, QueryOutcome, ShowQuery, periodPhrase, useAppHref, useTimeframe } from "../components/shared";
import { nativeDisplay, type Capability } from "../capabilities";
import { compactQuantity } from "../funnel";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { EntityIdLine, disambiguate, displayName, nameState } from "../components/EntityName";
import { Info } from "../components/Info";
import { R } from "../routes";
import { PriceTag } from "../components/Tags";
import { matches, useFilters, type FilterDef } from "../components/Filters";
import { PagerFooter, SortHeader, sortBy, usePager, useSortParam } from "../components/RankedList";
import { CsvDownload, type CsvColumn } from "../components/CsvDownload";
import { groupRows, useGroupBy } from "../components/GroupBy";
import { Toolbar } from "../components/Toolbar";
import { formatCost, formatQuantity, sourcesLabel, useRates, type RateSource, type Rates } from "../rates";

import { NextSteps } from "../components/NextSteps";
/**
 * Cost stacking: one row per host with
 * every capability billed to it, so the real cost of a machine is one number.
 * Ranked by the stack, never by any single capability.
 *
 * The stack can only be added up in money: GiB-hours and container-hours are
 * different units. Without a complete rate card for the host capabilities
 * present, no total is shown and hosts are ranked by how many capabilities
 * they stack, then by name.
 */
/** One compact row per host and capability (v0.12.3): the type's own quantity, summed in Grail. */
const stackQuery = (_fields: string[], qty: string) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and (isNotNull(dt.entity.host) or isNotNull(dt.smartscape.host))
| dedup event.id
{IN_PERIOD}
| fieldsAdd qty = ${qty}
| summarize {qty = sum(qty), n_qty = countIf(isNotNull(qty))},
    by:{host_id = coalesce(toString(dt.smartscape.host), dt.entity.host), event.type}
| lookup [fetch dt.entity.host | fields id, entity.name, hostGroupName, monitoringMode], sourceField: host_id, lookupField: id, prefix: "host."`;

type Layer = { cap: Capability; quantity: number };
type HostStack = { id: string; name: string; layers: Layer[]; cost: number | null; group: string | null; mode: string | null };

const MODE_LABEL: Record<string, string> = { FULL_STACK: "Full-Stack", INFRASTRUCTURE: "Infrastructure", DISCOVERY: "Discovery" };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function layerCost(rates: Rates, l: Layer): number | null {
  const rate = rates.rateFor(l.cap.eventType)?.value;
  return rate === undefined ? null : l.cap.toRateUnits(l.quantity) * rate;
}

const FILTERS: FilterDef[] = [{ key: "host", label: "Host name", kind: "search" }];

export const Stacking = () => {
  const { query, records, error, errorKind, partial, isLoading, retry, cancel, cancelled, resolve } = useMeasuredQuery(stackQuery, { maxRecords: ENTITY_RESULT_RECORDS });
  const f = useFilters(FILTERS);
  const rates = useRates();
  const [tf] = useTimeframe();
  const href = useAppHref();
  const navigate = useNavigate();

  const { hosts, capsPresent, unmeasured } = useMemo(() => {
    const byHost = new Map<string, HostStack>();
    const caps = new Map<string, Capability>();
    const other = new Set<string>();
    for (const r of records ?? []) {
      if (!r) continue;
      const eventType = String(r["event.type"]);
      const cap = resolve(eventType);
      const q = compactQuantity(r);
      if (q === null) {
        other.add(eventType);
        continue;
      }
      caps.set(eventType, cap);
      const id = String(r.host_id);
      const raw = r["host.entity.name"];
      const name = displayName(typeof raw === "string" ? raw : null, "host", nameState(r["host.id"], raw));
      const h = byHost.get(id) ?? {
        id,
        name,
        layers: [],
        cost: null,
        group: typeof r["host.hostGroupName"] === "string" && r["host.hostGroupName"] ? r["host.hostGroupName"] : null,
        mode: typeof r["host.monitoringMode"] === "string" ? r["host.monitoringMode"] : null,
      };
      h.layers.push({ cap, quantity: q });
      byHost.set(id, h);
    }
    return { hosts: [...byHost.values()], capsPresent: [...caps.values()], unmeasured: [...other].sort() };
  }, [records, resolve]);

  const missing = capsPresent.filter((c) => rates.rateFor(c.eventType) === null);
  // Priced layers are added up even when one capability has no price; the unpriced ones are
  // named instead of hiding every cost on this Cost screen.
  const costed = !rates.isLoading && capsPresent.length > missing.length;
  const sources = new Set<RateSource>(
    capsPresent.map((c) => rates.rateFor(c.eventType)?.source).filter((x): x is RateSource => x !== undefined),
  );
  const label = sourcesLabel(sources);
  const stacks: HostStack[] = hosts.map((h) => {
    const layers = [...h.layers].sort((x, y) => x.cap.eventType.localeCompare(y.cap.eventType));
    return { ...h, layers, cost: costed ? layers.reduce((sum, l) => sum + (layerCost(rates, l) ?? 0), 0) : null };
  });
  const sorted = disambiguate([...stacks].map((h) => ({ ...h, entityId: h.id }))).sort((a, b) =>
    costed ? (b.cost ?? 0) - (a.cost ?? 0) : b.layers.length - a.layers.length || a.name.localeCompare(b.name),
  );
  const filtered = sorted.filter((h) => matches(`${h.name} ${h.id}`, f.values.host));
  // Group by (v0.12.11): the same filtered hosts, cost added up per host group or monitoring mode.
  const [groupBy, setGroupBy] = useGroupBy(["hostGroup", "mode"] as const);
  const groups =
    groupBy === "host"
      ? []
      : groupRows(
          filtered,
          (h) => (groupBy === "hostGroup" ? h.group ?? "No host group" : h.mode ? MODE_LABEL[h.mode] ?? h.mode : "Monitoring mode unknown"),
          (h) => h.cost ?? 0,
        );
  // Opens ranked (most expensive first); a header click sorts by name or cost instead.
  const [sort, setSort] = useSortParam(["name", "cost"] as const, { by: "cost", dir: "desc" });
  const view = sort.by === "cost" && sort.dir === "desc" ? filtered : sortBy(filtered, sort, (h, k) => (k === "name" ? h.name : h.cost ?? h.layers.length));
  // Ten hosts, then 25 more at a time: a thousand-host environment never renders a thousand rows at once.
  const pager = usePager(view.length);
  const ranked = view.slice(0, pager.shown);

  // The file: one column per capability in its own unit, then cost per capability and the total when every rate is known.
  const capCols = [...capsPresent].sort((a, b) => a.eventType.localeCompare(b.eventType));
  const money = `${label || "rate"}, ${rates.currency}`;
  const csvColumns: CsvColumn<HostStack>[] = [
    { header: "Host name", value: (h) => h.name },
    { header: "Host ID", value: (h) => h.id },
    ...capCols.map((c) => ({
      header: `${c.eventType} (${c.nativeUnit})`,
      value: (h: HostStack) => {
        const l = h.layers.find((x) => x.cap.eventType === c.eventType);
        return l ? nativeDisplay(l.cap, l.quantity) : null;
      },
    })),
    ...(costed
      ? [
          ...capCols.map((c) => ({
            header: `${c.eventType} cost (${money})`,
            value: (h: HostStack) => {
              const l = h.layers.find((x) => x.cap.eventType === c.eventType);
              return l ? layerCost(rates, l) : null;
            },
          })),
          { header: missing.length ? `Cost of priced capabilities (${money})` : `Full cost (${money})`, value: (h: HostStack) => h.cost },
        ]
      : []),
  ];

  const n = hosts.length;
  const stacked = hosts.filter((h) => h.layers.length > 1).length;
  const top = filtered[0];
  const [setup, conclusion] =
    costed && top
      ? ["Your highest-cost host", `comes to ${formatCost(top.cost ?? 0, rates.currency)} across ${top.layers.length} ${plural(top.layers.length, "capability", "capabilities")}.`]
      : stacked > 0
        ? [`${stacked} of your ${n} ${plural(n, "host", "hosts")}`, `are billed for more than one capability.`]
        : [`Each of your ${n} ${plural(n, "host", "hosts")}`, "is billed for one capability."];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome query={query} records={records} error={error} errorKind={errorKind} partial={partial} isLoading={isLoading} retry={retry} cancel={cancel} cancelled={cancelled} empty={`No usage in ${periodPhrase(tf)} was billed to a host.`}>
        <Answer
          setup={setup}
          conclusion={conclusion}
          lead={
            costed
              ? `Ranked by the sum of every capability billed to each host in ${periodPhrase(tf)}, at ${label.charAt(0).toLowerCase() + label.slice(1)}.` +
                (missing.length ? ` Not included, because ${missing.length === 1 ? "it has" : "they have"} no price: ${missing.map((m) => m.eventType).join(", ")}.` : "")
              : `Per-capability screens show one layer at a time. The layers are in different units, and ${missing.map((m) => m.eventType).join(", ")} ${missing.length === 1 ? "has" : "have"} no price, so a host's full cost can't be added up. Hosts are ranked by how many capabilities they stack.`
          }
        />
        {costed && <PriceTag sources={sources} />}
        <Toolbar
          group={{
            value: groupBy,
            onChange: setGroupBy,
            options: [
              { value: "host", label: "Host" },
              { value: "hostGroup", label: "Host group" },
              { value: "mode", label: "Monitoring mode" },
            ],
          }}
          defs={FILTERS}
          f={f}
        />
        {groupBy !== "host" && (
          <div role="table" aria-label={`Cost by ${groupBy === "hostGroup" ? "host group" : "monitoring mode"}`} style={{ display: "flex", flexDirection: "column" }}>
            <div role="row" style={{ ...groupGrid, padding: `0 ${space[8]}px ${space[8]}px` }}>
              <span role="columnheader" style={headCell}>{groupBy === "hostGroup" ? "Host group" : "Monitoring mode"}</span>
              <span role="columnheader" style={{ ...headCell, textAlign: "right" }}>{costed ? "Full cost" : "Hosts"}</span>
            </div>
            {groups.map((g) => (
              <div key={g.key} role="row" style={{ ...groupGrid, borderTop: `1px solid ${color.line}`, padding: `${space[12]}px ${space[8]}px` }}>
                <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
                  <span style={{ ...type.heading }}>{g.key}</span>
                  <span style={{ ...type.body, color: color.textTertiary }}>
                    {g.count.toLocaleString(appLocale())} {g.count === 1 ? "host" : "hosts"}
                  </span>
                </span>
                <span role="cell" style={{ ...type.heading, textAlign: "right" }}>{costed ? formatCost(g.total, rates.currency) : g.count.toLocaleString(appLocale())}</span>
              </div>
            ))}
          </div>
        )}
        {filtered.length === 0 && <span style={{ ...type.body, color: color.textSecondary }}>No hosts match the filter.</span>}

        {groupBy === "host" && (
        <div role="table" aria-label="Hosts by cost, all capabilities" style={{ display: "flex", flexDirection: "column" }}>
          <div role="row" style={{ ...rowGrid, padding: `0 ${space[8]}px ${space[8]}px` }}>
            <span role="columnheader" style={headCell} aria-sort={sort.by === "name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortHeader label="Host" sortKey="name" sort={sort} onSort={setSort} first="asc" />
            </span>
            <span role="columnheader" style={headCell}>Capabilities billed</span>
            <span role="columnheader" aria-sort={sort.by === "cost" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} style={{ ...headCell, textAlign: "right", display: "inline-flex", gap: space[8], justifyContent: "flex-end", alignItems: "center" }}>
              <Info
                label="Full cost"
                guide={{
                  what: "Every capability billed to the host in the timeframe, each priced at its own rate and added up.",
                  why: "Each per-capability screen shows one layer; this adds the layers up at the rates in use.",
                  how: "Usage per capability from billing records naming the host, times the rate in use. Capabilities with no price are left out and named above the list.",
                  where: "Rates come from the Rate card: contract, list price or edited.",
                }}
              />
              {/* The List price tag is shown once, above the list; repeating it here squeezed the title onto two lines. */}
              <SortHeader label="Full cost" sortKey="cost" sort={sort} onSort={setSort} align="right" />
            </span>
          </div>
          {ranked.map((h) => (
            <div key={h.id} role="row" style={{ ...rowGrid, borderTop: `1px solid ${color.line}`, padding: `${space[12]}px ${space[8]}px` }}>
              <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
                <Link to={href(R.host(h.id))} className="lc-link" style={{ ...type.heading, color: color.textPrimary, textDecoration: "none", wordBreak: "break-word" }}>
                  {h.name}
                </Link>
                <EntityIdLine id={h.id} />
              </span>
              <span role="cell" style={{ display: "flex", flexWrap: "wrap", gap: space[8] }}>
                {h.layers.map((l, j) => {
                  const c = costed ? layerCost(rates, l) : null;
                  // Plain text, not pills: a filled pill reads as a button and these do nothing.
                  return (
                    <span key={l.cap.eventType} style={{ display: "inline-flex", alignItems: "baseline", gap: space[8], ...type.body }}>
                      {l.cap.eventType}
                      <span style={{ color: color.textSecondary }}>
                        {c !== null
                          ? formatCost(c, rates.currency)
                          : `${formatQuantity(nativeDisplay(l.cap, l.quantity))} ${l.cap.nativeUnit}`}
                        {j < h.layers.length - 1 ? "," : ""}
                      </span>
                    </span>
                  );
                })}
              </span>
              <span role="cell" style={{ ...type.heading, textAlign: "right", color: costed ? color.textPrimary : color.textTertiary }}>
                {costed ? formatCost(h.cost ?? 0, rates.currency) : "No price"}
              </span>
            </div>
          ))}
        </div>
        )}
        {groupBy === "host" && pager.needed && (
          <div style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[4], marginTop: -space[32] }}>
            <PagerFooter pager={pager} noun="hosts" />
          </div>
        )}
        <CsvDownload name="cost-per-host" noun="hosts" columns={csvColumns} rows={filtered} />

        {unmeasured.length > 0 && (
          <span style={{ ...type.body, color: color.textTertiary }}>
            Also billed to hosts, but no quantity field on these records: {unmeasured.join(", ")}.
          </span>
        )}

        {!costed && (
          <div style={{ display: "flex", alignItems: "center", gap: space[16], flexWrap: "wrap" }}>
            <PrimaryButton onClick={() => navigate(href(R.rates))}>Set the missing rates</PrimaryButton>
            <span style={{ ...type.body, color: color.textTertiary }}>
              Needed for: {missing.map((c) => `${c.eventType} (${c.rateUnit})`).join(", ")}.
            </span>
          </div>
        )}
      </QueryOutcome>
      <NextSteps links={[{ to: R.fixes, label: "Open Findings" }, { to: R.ownership, label: "Give these hosts an owner" }]} />
      <ShowQuery query={query} />
    </div>
  );
};

const rowGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(200px, 1.2fr) minmax(200px, 2fr) minmax(140px, 0.6fr)",
  gap: space[24],
  alignItems: "center",
};

const groupGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 160px", gap: space[24], alignItems: "center" };
const headCell: React.CSSProperties = { ...type.label, color: color.textTertiary, paddingBottom: space[8] };
