import React, { useMemo } from "react";
import { Toolbar, countOptions } from "../components/Toolbar";
import { PeriodDelta } from "../components/PeriodDelta";

import { color, space, type, layout } from "../design/tokens";
import { Answer } from "../design/primitives";
import { RankedRows, concentrationAnswer, type RankedItem } from "../components/RankedList";
import { matches, useFilters, type FilterDef } from "../components/Filters";
import { CsvDownload } from "../components/CsvDownload";
import { Bone, DataAsOf, ENTITY_RESULT_RECORDS, QueryOutcome, ShowQuery, asNumber, useAppHref, useBillingQuery, usePeriod } from "../components/shared";
import { formatQuantity } from "../rates";
import { displayName, nameState } from "../components/EntityName";

import { NextSteps } from "../components/NextSteps";
import { R } from "../routes";
/**
 * Applications: RUM sessions per application, and synthetic usage per monitor.
 * Web apps carry dt.entity.application; mobile apps dt.entity.device_application
 * (Semantic Dictionary; NOT VERIFIED in the development environment, which has no mobile apps);
 * dt.smartscape.frontend is read as a fallback. Session Replay is billed as its
 * own capability and shown beside the app's sessions.
 */
const RUM_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter in(event.type, {"Real User Monitoring", "Real User Monitoring with Session Replay", "Real User Monitoring Property"})
| dedup event.id
{IN_PERIOD}
| fieldsAdd app_id = coalesce(dt.entity.application, dt.entity.device_application, toString(dt.smartscape.frontend)),
    platform = coalesce(device.type, if(isNotNull(dt.entity.device_application), "mobile"), if(isNotNull(dt.entity.application), "web"))
| summarize {sessions = sum(billed_sessions), n_sessions = countIf(isNotNull(billed_sessions)),
    replays = sum(billed_replay_sessions), n_replays = countIf(isNotNull(billed_replay_sessions)),
    properties = sum(billed_property_sessions), n_properties = countIf(isNotNull(billed_property_sessions)),
    last_record = max(timestamp)},
    by:{app_id, platform}
| lookup [fetch dt.entity.application | fields id, entity.name], sourceField: app_id, lookupField: id, prefix: "web."
| lookup [fetch dt.entity.mobile_application | fields id, entity.name], sourceField: app_id, lookupField: id, prefix: "mobile."`;

/**
 * Synthetic: browser monitors and clickpaths bill synthetic actions, HTTP
 * monitors bill requests. Both spellings of the browser type are accepted
 *. Monitor fields are NOT VERIFIED in the development environment (no
 * synthetic billing there); names need storage:smartscape:read, which the app
 * does not have, so monitors show their id.
 */
const SYNTHETIC_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter in(event.type, {"Browser Monitor or Clickpath", "Browser Monitor and Clickpath", "HTTP Monitor"})
| dedup event.id
{IN_PERIOD}
| fieldsAdd monitor_id = coalesce(toString(dt.smartscape.browser_monitor), toString(dt.smartscape.http_monitor), dt.entity.synthetic_test, dt.entity.http_check)
| summarize {actions = sum(billed_synthetic_action_count), n_actions = countIf(isNotNull(billed_synthetic_action_count)),
    requests = sum(billed_http_request_count), n_requests = countIf(isNotNull(billed_http_request_count)),
    last_record = max(timestamp)},
    by:{monitor_id, event.type}
| lookup [fetch dt.entity.synthetic_test | fields id, entity.name], sourceField: monitor_id, lookupField: id, prefix: "browser."
| lookup [fetch dt.entity.http_check | fields id, entity.name], sourceField: monitor_id, lookupField: id, prefix: "http."`;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const FILTERS: FilterDef[] = [
  {
    key: "platform",
    label: "Web or mobile",
    kind: "select",
    options: [
      { value: "web", label: "Web" },
      { value: "mobile", label: "Mobile" },
    ],
  },
  { key: "app", label: "Name", kind: "search" },
];

/** Monitors have no web/mobile split: only the name search applies. */
const MONITOR_FILTERS: FilterDef[] = FILTERS.filter((d) => d.key !== "platform");

/**
 * `show` picks the Entities type (v0.10.0): applications (RUM) or synthetic
 * monitors. Both queries are unchanged; only the matching section renders.
 */
export const Applications = ({ show = "applications" }: { show?: "applications" | "monitors" }) => {
  const rum = useBillingQuery(RUM_QUERY, { maxRecords: ENTITY_RESULT_RECORDS });
  const syn = useBillingQuery(SYNTHETIC_QUERY, { maxRecords: ENTITY_RESULT_RECORDS });
  const period = usePeriod();
  const href = useAppHref();
  const f = useFilters(show === "monitors" ? MONITOR_FILTERS : FILTERS);

  const { apps, lastRum } = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; platform: string; sessions: number; replays: number | null; properties: number | null }>();
    let newest: string | null = null;
    for (const r of rum.records ?? []) {
      if (!r || typeof r.app_id !== "string") continue;
      const platform = str(r.platform)?.toLowerCase() === "mobile" ? "mobile" : "web";
      const lookupId = platform === "mobile" ? r["mobile.id"] : r["web.id"];
      const raw = platform === "mobile" ? r["mobile.entity.name"] : r["web.entity.name"];
      const name = displayName(str(raw), "application", nameState(lookupId, raw));
      const a = byId.get(r.app_id) ?? { id: r.app_id, name, platform, sessions: 0, replays: null, properties: null };
      if (asNumber(r.n_sessions) > 0) a.sessions += asNumber(r.sessions);
      if (asNumber(r.n_replays) > 0) a.replays = (a.replays ?? 0) + asNumber(r.replays);
      if (asNumber(r.n_properties) > 0) a.properties = (a.properties ?? 0) + asNumber(r.properties);
      byId.set(r.app_id, a);
      if (typeof r.last_record === "string" && (!newest || r.last_record > newest)) newest = r.last_record;
    }
    return { apps: [...byId.values()], lastRum: newest };
  }, [rum.records]);

  const monitors = useMemo(() => {
    const out: { id: string; name: string; kind: string; value: number; unit: string }[] = [];
    for (const r of syn.records ?? []) {
      if (!r || typeof r.monitor_id !== "string") continue;
      const http = String(r["event.type"]) === "HTTP Monitor";
      const n = http ? asNumber(r.n_requests) : asNumber(r.n_actions);
      if (n === 0) continue;
      const lookupId = http ? r["http.id"] : r["browser.id"];
      const raw = http ? r["http.entity.name"] : r["browser.entity.name"];
      out.push({
        id: r.monitor_id,
        name: displayName(str(raw), http ? "HTTP monitor" : "browser monitor", typeof lookupId === "string" && lookupId ? nameState(lookupId, raw) : "unnamed"),
        kind: http ? "HTTP monitor" : "Browser monitor or clickpath",
        value: http ? asNumber(r.requests) : asNumber(r.actions),
        unit: http ? "synthetic requests" : "synthetic actions",
      });
    }
    return out;
  }, [syn.records]);

  const shownApps = apps.filter((a) => f.pick("platform", a.platform) && matches(`${a.name} ${a.id}`, f.values.app));
  const shownMonitors = show === "applications" && f.values.platform ? [] : monitors.filter((m) => matches(`${m.name} ${m.id}`, f.values.app));
  const units = [...new Set(shownMonitors.map((m) => m.unit))];
  const [monSetup, monConclusion] = concentrationAnswer(
    shownMonitors.map((m) => m.value),
    { one: "monitor", many: "monitors" },
    units.length === 1 ? units[0] : "synthetic usage",
  );
  const [setup, conclusion] = concentrationAnswer(
    shownApps.map((a) => a.sessions),
    { one: "application", many: "applications" },
    "Real User Monitoring sessions",
  );
  const appItems: RankedItem[] = shownApps.map((a) => ({
    id: a.id,
    name: a.name,
    entityId: a.id,
    detail: `${a.platform === "mobile" ? "Mobile" : "Web"} application`,
    value: a.sessions,
    // Session Replay and RUM Property are billed per application too.
    extras:
      [a.replays !== null ? `${formatQuantity(a.replays)} session replay captures` : null, a.properties !== null ? `${formatQuantity(a.properties)} property sessions` : null]
        .filter(Boolean)
        .map((t, i) => (i === 0 ? `Also billed: ${t}` : t))
        .join(", ") || undefined,
  }));


  const monitorRows = units.map((u) => (
    <RankedRows
      key={u}
      unit={u}
      itemLabel="Monitor"
      href={href}
      items={shownMonitors
        .filter((m) => m.unit === u)
        .map((m) => ({ id: m.id, name: m.name, entityId: m.id, detail: m.kind, value: m.value }))}
    />
  ));
  const monitorNote = (
    <span style={{ ...type.body, color: color.textTertiary }}>
      Monitor names come from the synthetic monitor entities. A monitor known only by its ID in the newer Smartscape format
      shows as unnamed: resolving those needs a permission this app does not request.
    </span>
  );

  if (show === "monitors") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
        <QueryOutcome
          query={syn.query}
          records={syn.records}
          error={syn.error}
          errorKind={syn.errorKind}
          partial={syn.partial}
          isLoading={syn.isLoading}
          retry={syn.retry} cancel={syn.cancel} cancelled={syn.cancelled}
          empty={`No synthetic monitor usage was billed in ${period.phrase}.`}
          skeleton={<AppsSkeleton />}
        >
          <Answer
            setup={shownMonitors.length > 0 ? monSetup : "No monitors"}
            conclusion={shownMonitors.length > 0 ? monConclusion : "match the filters."}
            lead={`Synthetic usage billed in ${period.phrase}: browser monitors and clickpaths in synthetic actions, HTTP monitors in requests.`}
            delta={<PeriodDelta filter={`in(event.type, {"Browser Monitor or Clickpath", "Browser Monitor and Clickpath", "HTTP Monitor"})`} quantity="coalesce(billed_synthetic_action_count, billed_http_request_count)" unit="synthetic actions and requests" />}
          />
          <Toolbar defs={MONITOR_FILTERS} f={f} />
          <section aria-label="Synthetic monitors" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            {monitorRows}
            <CsvDownload
              name="synthetic-monitors"
              noun="monitors"
              rows={[...shownMonitors].sort((a, b) => a.unit.localeCompare(b.unit) || b.value - a.value)}
              columns={[
                { header: "Monitor", value: (m) => m.name },
                { header: "Monitor ID", value: (m) => m.id },
                { header: "Type", value: (m) => m.kind },
                { header: "Quantity", value: (m) => m.value },
                { header: "Unit", value: (m) => m.unit },
              ]}
            />
            {monitorNote}
          </section>
        </QueryOutcome>
        <NextSteps links={[{ to: R.spend, label: "See what it costs" }]} />
        <ShowQuery query={syn.query} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome
        query={rum.query}
        records={rum.records}
        error={rum.error}
        errorKind={rum.errorKind}
        partial={rum.partial}
        isLoading={rum.isLoading}
        retry={rum.retry} cancel={rum.cancel} cancelled={rum.cancelled}
        empty={`No Real User Monitoring sessions were billed in ${period.phrase}.`}
        skeleton={<AppsSkeleton />}
      >
        <Answer
          setup={shownApps.length > 0 ? setup : "No applications"}
          conclusion={shownApps.length > 0 ? conclusion : "match the filters."}
          lead={`Real User Monitoring sessions billed in ${period.phrase}, web and mobile together. Synthetic monitors have their own type.`}
          delta={<PeriodDelta filter={`in(event.type, {"Real User Monitoring"})`} quantity="billed_sessions" unit="sessions" />}
        />
        <DataAsOf last={lastRum} />
        <Toolbar defs={FILTERS} f={f} counts={countOptions(apps, { platform: (a) => a.platform })} />
        <section aria-label="Applications" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
          <RankedRows items={appItems} unit="sessions" itemLabel="Application" href={href} />
          <CsvDownload
            name="applications"
            noun="applications"
            rows={[...shownApps].sort((a, b) => b.sessions - a.sessions)}
            columns={[
              { header: "Application", value: (a) => a.name },
              { header: "Application ID", value: (a) => a.id },
              { header: "Platform", value: (a) => (a.platform === "mobile" ? "Mobile" : "Web") },
              { header: "Sessions", value: (a) => a.sessions },
              { header: "Session replay captures", value: (a) => a.replays },
              { header: "Property sessions", value: (a) => a.properties },
            ]}
          />
        </section>
      </QueryOutcome>
      <NextSteps links={[{ to: R.fixes, label: "Check the Session Replay share" }, { to: R.spend, label: "See what it costs" }]} />
      <ShowQuery query={rum.query} />
    </div>
  );
};

function AppsSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
        <Bone w="85%" h={38} />
        <Bone w="60%" h={24} />
      </section>
      {[0, 1, 2].map((i) => (
        <Bone key={i} w="100%" h={62} r={8} />
      ))}
    </div>
  );
}
