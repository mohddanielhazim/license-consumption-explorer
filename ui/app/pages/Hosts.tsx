import React from "react";
import { useParams } from "react-router-dom";

import { RankedList, RankedRows, concentrationAnswer, type RankedItem } from "../components/RankedList";
import { matches, useFilters, type FilterDef } from "../components/Filters";
import { CsvDownload, type CsvColumn } from "../components/CsvDownload";
import { NextSteps } from "../components/NextSteps";
import { PeriodDelta } from "../components/PeriodDelta";
import { groupRows, useGroupBy } from "../components/GroupBy";
import { Toolbar, countOptions } from "../components/Toolbar";
import { OpenInDynatrace } from "../components/OpenInDynatrace";
import { EntityIdLine, displayName, nameState } from "../components/EntityName";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
import { color, space, type } from "../design/tokens";
import { Card } from "../design/primitives";
import { MiniBars } from "../components/MiniBars";
import { startsMidDay, utcDaysBetween } from "../data/math";
import {
  periodPhrase,
  usePeriod,
  DataAsOf,
  useTimeframe,
  Crumbs,
  PageTitle,
  QueryOutcome,
  ShowQuery,
  asNumber,
  useAppHref,
  useBillingQuery,
  ENTITY_RESULT_RECORDS,
} from "../components/shared";
import { R } from "../routes";
import { COST_CENTRE_FIELDS } from "../funnel";
import { dayShiftMinutes, zoneLabel, appLocale } from "../locale";
import { formatQuantity } from "../rates";

const FSM = "Full-Stack Monitoring";
const CODE = "Code Monitoring";



/** Host ids go into a query string, so accept only the entity id shape. */
const safeHostId = (id: string | undefined) => (id && /^HOST-[A-F0-9]+$/.test(id) ? id : null);

/** Capabilities billed per host. */
const HOST_CAPABILITIES = [
  { type: FSM, field: "billed_gibibyte_hours", unit: "GiB-hours" },
  { type: "Infrastructure Monitoring", field: "billed_host_hours", unit: "host-hours" },
  { type: "Foundation & Discovery", field: "billed_host_hours", unit: "host-hours" },
  { type: "Runtime Vulnerability Analytics", field: "billed_gibibyte_hours", unit: "GiB-hours" },
  { type: "Runtime Application Protection", field: "billed_gibibyte_hours", unit: "GiB-hours" },
] as const;

/**
 * Hosts: every host-billed capability per host, in one query. The host id
 * comes from dt.smartscape.host (dt.entity.host is deprecated), falling back
 * to dt.entity.host for older records. Both are converted to text: the
 * smartscape id is a different data type, and without toString the same host
 * splits into two groups and loses its name (checked in the development environment, 90 days:
 * 21 groups instead of 13). Names come from a lookup on dt.entity.host.
 */
const HOSTS_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter in(event.type, {${HOST_CAPABILITIES.map((c) => `"${c.type}"`).join(", ")}})
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| fieldsAdd host_id = coalesce(toString(dt.smartscape.host), dt.entity.host)
| summarize {${HOST_CAPABILITIES.map((c, i) => `q${i} = sum(if(event.type == "${c.type}", ${c.field})), n${i} = countIf(event.type == "${c.type}" and isNotNull(${c.field}))`).join(",\n    ")},
    tagged = countIf(isNotNull(cost_centre)),
    last_record = max(timestamp)},
    by:{host_id}
| lookup [fetch dt.entity.host | fields id, entity.name, monitoringMode, hostGroupName], sourceField: host_id, lookupField: id, prefix: "host."`;

type HostUsage = {
  id: string;
  name: string;
  byType: Map<string, number>;
  mode: string | null;
  group: string | null;
  tagged: boolean;
};

const MODE_LABEL: Record<string, string> = {
  FULL_STACK: "Full-Stack",
  INFRASTRUCTURE: "Infrastructure",
  DISCOVERY: "Discovery",
};

const HOST_FILTERS = (groups: string[]): FilterDef[] => [
  { key: "name", label: "Host name", kind: "search" },
  {
    key: "mode",
    label: "Monitoring mode",
    kind: "select",
    options: Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label })),
  },
  {
    key: "group",
    label: "Host group",
    kind: "select",
    options: [{ value: "__none", label: "No host group" }, ...groups.map((g) => ({ value: g, label: g }))],
  },
  {
    key: "tag",
    label: "Cost centre",
    kind: "select",
    single: true,
    options: [
      { value: "yes", label: "Has a cost centre" },
      { value: "no", label: "No cost centre" },
    ],
  },
];

const fmtLayer = (type: string, value: number) => {
  const cap = HOST_CAPABILITIES.find((c) => c.type === type);
  return `${type} ${formatQuantity(value)} ${cap?.unit ?? ""}`.trim();
};

export const Hosts = () => {
  const { query, records, error, errorKind, partial, isLoading, retry, cancel, cancelled } = useBillingQuery(HOSTS_QUERY, { maxRecords: ENTITY_RESULT_RECORDS });
  const [tf] = useTimeframe();
  const href = useAppHref();
  const phrase = periodPhrase(tf);

  const hosts = new Map<string, HostUsage>();
  let last: string | null = null;
  for (const r of records ?? []) {
    if (!r || typeof r.host_id !== "string") continue;
    // One row per host (v0.12.3): capability i in columns q<i> / n<i>.
    const measured = HOST_CAPABILITIES.map((c, i) => [c.type, asNumber(r[`n${i}`]), asNumber(r[`q${i}`])] as const).filter(([, n]) => n > 0);
    if (measured.length === 0) continue;
    const name = displayName(str(r["host.entity.name"]), "host", nameState(r["host.id"], r["host.entity.name"]));
    const h =
      hosts.get(r.host_id) ??
      {
        id: r.host_id,
        name,
        byType: new Map<string, number>(),
        mode: typeof r["host.monitoringMode"] === "string" ? r["host.monitoringMode"] : null,
        group: typeof r["host.hostGroupName"] === "string" && r["host.hostGroupName"] ? r["host.hostGroupName"] : null,
        tagged: false,
      };
    for (const [type, , value] of measured) h.byType.set(type, (h.byType.get(type) ?? 0) + value);
    if (asNumber(r.tagged) > 0) h.tagged = true;
    hosts.set(r.host_id, h);
    if (typeof r.last_record === "string" && (!last || r.last_record > last)) last = r.last_record;
  }

  // Ranked by Full-Stack; hosts with no Full-Stack usage are ranked separately
  // by host-hours so none is dropped.
  const extrasFor = (h: HostUsage, primary: string) => {
    const others = [...h.byType.entries()].filter(([t]) => t !== primary);
    return others.length ? `Also billed: ${others.map(([t, v]) => fmtLayer(t, v)).join(", ")}` : undefined;
  };
  const toItem = (h: HostUsage, primary: string): RankedItem => ({
    id: h.id,
    name: h.name,
    entityId: h.id,
    disambiguator: h.group ?? undefined,
    detail: [h.mode ? MODE_LABEL[h.mode] ?? h.mode : null, h.group ? `host group ${h.group}` : null].filter(Boolean).join(", ") || undefined,
    value: h.byType.get(primary) ?? 0,
    to: R.host(h.id),
    extras: extrasFor(h, primary),
  });
  const everyHost = [...hosts.values()];
  const groups = [...new Set(everyHost.map((h) => h.group).filter((g): g is string => g !== null))].sort();
  const defs = HOST_FILTERS(groups);
  const f = useFilters(defs);
  const all = everyHost.filter(
    (h) =>
      matches(`${h.name} ${h.id}`, f.values.name) &&
      f.pick("mode", h.mode) &&
      f.pick("group", h.group ?? "__none") &&
      (!f.values.tag || (f.values.tag === "yes") === h.tagged),
  );
  const filtered = Object.keys(f.values).length > 0;
  const fullStack = all.filter((h) => h.byType.has(FSM)).map((h) => toItem(h, FSM));
  const hostHourOnly = all
    .filter((h) => !h.byType.has(FSM))
    .map((h) => {
      const primary = [...h.byType.keys()].find((t) => t === "Infrastructure Monitoring" || t === "Foundation & Discovery") ?? [...h.byType.keys()][0];
      return toItem(h, primary);
    });

  // Group by (v0.12.11): the same filtered hosts, added up per host group, monitoring mode or cost tag.
  const [groupBy, setGroupBy] = useGroupBy(["hostGroup", "mode", "tag"] as const);
  const primaryItems = fullStack.length > 0 ? fullStack : hostHourOnly;
  const groupKey = (h: HostUsage) =>
    groupBy === "hostGroup" ? h.group ?? "No host group" : groupBy === "mode" ? (h.mode ? MODE_LABEL[h.mode] ?? h.mode : "Monitoring mode unknown") : h.tagged ? "Has a cost centre" : "No cost centre";
  const groupedItems: RankedItem[] =
    groupBy === "host"
      ? []
      : groupRows(primaryItems, (i) => groupKey(hosts.get(i.id) as HostUsage), (i) => i.value).map((g) => ({
          id: `group:${g.key}`,
          name: g.key,
          detail: `${g.count.toLocaleString(appLocale())} ${g.count === 1 ? "host" : "hosts"}`,
          value: g.total,
        }));
  const groupNoun = groupBy === "hostGroup" ? { one: "host group", many: "host groups" } : groupBy === "mode" ? { one: "monitoring mode", many: "monitoring modes" } : { one: "group", many: "groups" };

  // The file: every matching host, Full-Stack first, then the rest, each in the screen's order.
  const csvRows = [...fullStack, ...hostHourOnly].map((i) => hosts.get(i.id)).filter((h): h is HostUsage => h !== undefined);
  const csvColumns: CsvColumn<HostUsage>[] = [
    { header: "Host name", value: (h) => h.name },
    { header: "Host ID", value: (h) => h.id },
    { header: "Monitoring mode", value: (h) => (h.mode ? MODE_LABEL[h.mode] ?? h.mode : null) },
    { header: "Host group", value: (h) => h.group },
    { header: "Has a cost centre", value: (h) => h.tagged },
    ...HOST_CAPABILITIES.map((c) => ({ header: `${c.type} (${c.unit})`, value: (h: HostUsage) => h.byType.get(c.type) ?? null })),
  ];

  const measure = fullStack.length > 0 ? "Full-Stack usage" : "host monitoring usage";
  const [setup, conclusion] =
    groupBy !== "host"
      ? concentrationAnswer(groupedItems.map((i) => i.value), groupNoun, measure)
      : concentrationAnswer(primaryItems.map((i) => i.value), { one: "host", many: "hosts" }, measure);

  return (
    <RankedList
      query={query}
      records={records}
      error={error}
      errorKind={errorKind}
      partial={partial}
      last={last}
      isLoading={isLoading}
      retry={retry}
      cancel={cancel}
      cancelled={cancelled}
      items={groupBy === "host" ? primaryItems : groupedItems}
      setup={setup}
      conclusion={conclusion}
      lead={`Ranked by ${fullStack.length > 0 ? "Full-Stack Monitoring GiB-hours" : "host-hours"} billed in ${phrase}${filtered ? `, among the ${all.length} of ${everyHost.length} hosts that match the filters` : ""}. Other host capabilities are listed under each host. Open a host for its usage by day.`}
      filters={
        <Toolbar
          group={{
            value: groupBy,
            onChange: setGroupBy,
            options: [
              { value: "host", label: "Host" },
              { value: "hostGroup", label: "Host group" },
              { value: "mode", label: "Monitoring mode" },
              { value: "tag", label: "Cost centre" },
            ],
          }}
          defs={defs}
          f={f}
          counts={countOptions(everyHost, { mode: (h) => h.mode, group: (h) => h.group ?? "__none", tag: (h) => (h.tagged ? "yes" : "no") })}
        />
      }
      unit={fullStack.length > 0 ? "GiB-hours" : "host-hours"}
      itemLabel={groupBy === "host" ? "Host" : groupBy === "hostGroup" ? "Host group" : groupBy === "mode" ? "Monitoring mode" : "Cost centre"}
      empty={`No host monitoring usage was billed in ${phrase}.`}
      download={<CsvDownload name="hosts" noun="hosts" columns={csvColumns} rows={csvRows} />}
      delta={
        fullStack.length > 0 ? (
          <PeriodDelta filter={`event.type == "${FSM}"`} quantity="billed_gibibyte_hours" unit="GiB-hours" noun="of Full-Stack" />
        ) : (
          <PeriodDelta filter={`in(event.type, {"Infrastructure Monitoring", "Foundation & Discovery"})`} quantity="billed_host_hours" unit="host-hours" />
        )
      }
      next={<NextSteps links={[{ to: R.perHost, label: "See what each host costs" }, { to: R.ownership, label: "Give hosts an owner" }]} />}
      secondary={
        groupBy === "host" && fullStack.length > 0 && hostHourOnly.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
            <span style={{ ...type.heading }}>
              {hostHourOnly.length} {hostHourOnly.length === 1 ? "host is" : "hosts are"} billed without Full-Stack
              Monitoring
            </span>
            <RankedRows items={hostHourOnly} unit="host-hours" itemLabel="Host" href={href} />
          </div>
        ) : undefined
      }
    />
  );
};

/** Every host capability with the field that measures it and its unit (same list as the Hosts screen). */
const HOST_QTY = `coalesce(toDouble(billed_gibibyte_hours), toDouble(billed_host_hours), toDouble(billed_container_hours))`;
const DETAIL_CAPS: { type: string; unit: string }[] = [...HOST_CAPABILITIES.map((c) => ({ type: c.type, unit: c.unit })), { type: CODE, unit: "container-hours" }];

/**
 * One host (v0.12.12): who owns it, then one card per capability billed to it with its
 * total and a daily preview, in the units the Hosts list ranks by, so the numbers carry
 * over from the list. Code Monitoring by namespace below.
 */
export const HostDetail = () => {
  const params = useParams();
  const hostId = safeHostId(params.hostId);
  const period = usePeriod();
  const typeList = DETAIL_CAPS.map((c) => `"${c.type}"`).join(", ");
  const hostMatch = `coalesce(toString(dt.smartscape.host), dt.entity.host) == "${hostId ?? "none"}"`;

  const summaryTemplate = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and ${hostMatch}
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| summarize cost_centres = collectDistinct(cost_centre), last_record = max(timestamp), by:{host_id = coalesce(toString(dt.smartscape.host), dt.entity.host)}
| lookup [fetch dt.entity.host | fields id, entity.name, hostGroupName, monitoringMode], sourceField: host_id, lookupField: id, prefix: "host."`;
  const dailyTemplate = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and ${hostMatch} and in(event.type, {${typeList}})
| dedup event.id
{IN_PERIOD}
| summarize qty = sum(${HOST_QTY}), by:{event.type, day = bin(coalesce(toTimestamp(usage.start), timestamp){DAY_SHIFT}, 1d)}`;
  const nsTemplate = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "${CODE}" and ${hostMatch}
| dedup event.id
{IN_PERIOD}
| summarize container_hours = sum(billed_container_hours), by:{k8s.namespace.name}
| sort container_hours desc`;

  const summary = useBillingQuery(summaryTemplate);
  const daily = useBillingQuery(dailyTemplate);
  const ns = useBillingQuery(nsTemplate);
  const days = utcDaysBetween(period.fromIso, period.toIso, dayShiftMinutes());

  if (!hostId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
        <Crumbs trail={[{ label: "Hosts", to: R.entities("hosts") }, { label: "Unknown host" }]} />
        <span style={{ ...type.bodyLarge }}>That is not a host entity ID.</span>
      </div>
    );
  }

  const r = summary.records?.[0] ?? null;
  const name = r ? displayName(str(r["host.entity.name"]), "host", nameState(r["host.id"], r["host.entity.name"])) : "Host";
  const group = r ? str(r["host.hostGroupName"]) : null;
  const mode = r ? str(r["host.monitoringMode"]) : null;
  const realCc = r && Array.isArray(r.cost_centres) ? (r.cost_centres as unknown[]).filter((x): x is string => typeof x === "string" && x !== "") : [];

  // Per capability: total and one value per day (null where nothing was billed).
  const perCap = new Map<string, Map<string, number>>();
  for (const d of daily.records ?? []) {
    if (!d) continue;
    const t = String(d["event.type"]);
    const day = typeof d.day === "object" && d.day !== null ? String((d.day as { start?: string }).start ?? "").slice(0, 10) : String(d.day).slice(0, 10);
    const m = perCap.get(t) ?? new Map<string, number>();
    m.set(day, (m.get(day) ?? 0) + asNumber(d.qty));
    perCap.set(t, m);
  }
  const billed = DETAIL_CAPS.filter((c) => perCap.has(c.type));
  const nsRows = (ns.records ?? []).flatMap((d) =>
    d ? [{ namespace: typeof d["k8s.namespace.name"] === "string" ? d["k8s.namespace.name"] : "(no namespace)", hours: asNumber(d.container_hours) }] : [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <div style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
        <Crumbs trail={[{ label: "Hosts", to: R.entities("hosts") }, { label: name }]} />
        <PageTitle title={name} lead={[mode ? MODE_LABEL[mode] ?? mode : null, group ? `host group ${group}` : null].filter(Boolean).join(", ") || undefined} />
        <span style={{ display: "flex", alignItems: "center", gap: space[16], flexWrap: "wrap" }}>
          <EntityIdLine id={hostId} />
          {/* Dynatrace picks the app that shows this host (an intent, not a hard-coded link). */}
          <OpenInDynatrace field="dt.entity.host" id={hostId} />
        </span>
      </div>
      <QueryOutcome query={summary.query} records={summary.records} error={summary.error} isLoading={summary.isLoading} retry={summary.retry} cancel={summary.cancel} cancelled={summary.cancelled}>
        <span style={{ ...type.bodyLarge, color: color.textSecondary }}>
          {realCc.length > 0 ? `Owned: cost centre ${realCc.join(", ")}.` : "No owner yet: no cost centre on its billing records, so its usage can't be charged to a team."}
        </span>
        <DataAsOf last={r && typeof r.last_record === "string" ? r.last_record : null} />
      </QueryOutcome>

      <QueryOutcome query={daily.query} records={daily.records} error={daily.error} isLoading={daily.isLoading} retry={daily.retry} cancel={daily.cancel} cancelled={daily.cancelled} empty={`Nothing was billed to this host in ${period.phrase}.`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: space[16] }}>
          {billed.map((c) => {
            const m = perCap.get(c.type) as Map<string, number>;
            const total = [...m.values()].reduce((a, b) => a + b, 0);
            return (
              <Card key={c.type} style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
                <span style={{ ...type.label, color: color.textTertiary }}>{c.type}</span>
                <span style={{ ...type.title }}>
                  {formatQuantity(total)} <span style={{ ...type.body, color: color.textSecondary }}>{c.unit}</span>
                </span>
                <MiniBars days={days} values={days.map((d) => (m.has(d) ? (m.get(d) as number) : null))} unit={c.unit} label={c.type} partialFirst={startsMidDay(period.fromIso, dayShiftMinutes())} />
              </Card>
            );
          })}
        </div>
        <span style={{ ...type.body, color: color.textTertiary }}>Days in your time zone ({zoneLabel()}). Outlined days are still arriving or hold part of a day.</span>
      </QueryOutcome>

      {perCap.has(CODE) && nsRows.length > 0 && (
        <section aria-label="Code Monitoring by namespace" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
          <h2 style={{ margin: 0, ...type.title }}>Code Monitoring by namespace</h2>
          <div role="table" aria-label="Container-hours by namespace" style={{ display: "flex", flexDirection: "column" }}>
            {nsRows.map((n) => (
              <div key={n.namespace} role="row" style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) 160px", gap: space[24], padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
                <span role="cell" style={{ ...type.body }}>{n.namespace}</span>
                <span role="cell" style={{ ...type.body, textAlign: "right" }}>{formatQuantity(n.hours)} container-hour{formatQuantity(n.hours) === "1" ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <ShowQuery query={daily.query} />
    </div>
  );
};
