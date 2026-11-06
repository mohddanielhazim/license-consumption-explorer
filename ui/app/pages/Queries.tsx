import React, { useMemo, useState } from "react";
import { NAME } from "../strings";
import { appLocale } from "../locale";
import { PeriodDelta } from "../components/PeriodDelta";
import { useSearchParams } from "react-router-dom";

import { color, space, type } from "../design/tokens";
import { Answer, SecondaryButton } from "../design/primitives";
import { Toolbar } from "../components/Toolbar";
import { matches, useFilters, type FilterDef } from "../components/Filters";
import { PagerFooter, RankedRows, concentrationAnswer, usePager, type RankedItem } from "../components/RankedList";
import { openApp } from "@dynatrace-sdk/navigation";
import { PriceTag } from "../components/Tags";
import { CsvDownload } from "../components/CsvDownload";
import { Info } from "../components/Info";
import { Bone, DataAsOf, QueryOutcome, ShowQuery, asNumber, useAppHref, useBillingQuery, usePeriod } from "../components/shared";
import { formatCost, formatQuantity, sourcesLabel, useRates, type RateSource } from "../rates";
import { NOT_CHARGED } from "../data/listPrices";

import { NextSteps } from "../components/NextSteps";
import { R } from "../routes";
/**
 * Queries and actors. Source: Query billing
 * records (GiB scanned, the billed figure). user.email is used only inside
 * the query, to tell service accounts from people, and is removed before any
 * result leaves Grail. Privacy modes:
 *   Aggregate (default)  apps, dashboards, workflows, service accounts; people
 *                        pooled per app, groups below 5 people hidden
 *   Pseudonymised        a stable hash of user.id per person, made in Grail
 *   By person names      hidden by default; revealed only when the viewer asks (v0.12.12)
 */
const ACTOR_KIND = `if(isNotNull(client.internal_service_context), "Dynatrace platform service",
      else: if(user.id == "system", "System and automation",
      else: if(contains(coalesce(user.email, ""), "service.sso.dynatrace") or startsWith(coalesce(user.email, ""), "dt0s"), "Service account",
      else: "Person")))`;

const SOURCE = `coalesce(client.application_context, client.internal_service_context, "")`;

/**
 * Human names for query sources (entity display rule). Dynatrace's own apps
 * and services are named from this list; a custom app's display name lives
 * in the app registry, which needs a scope this app does not request, so it
 * shows as "Custom app" with its ID beneath.
 */
const KNOWN_SOURCES: Record<string, string> = {
  "dynatrace.dashboards": "Dashboards",
  "dynatrace.notebooks": "Notebooks",
  "dynatrace.automations": "Workflows",
  "local-dev-mode": "Apps in local development",
  "dt.mcp.gateway": "Dynatrace MCP server",
};

function sourceName(id: string, kind: string): string {
  if (!id) return "Unknown source";
  if (KNOWN_SOURCES[id]) return KNOWN_SOURCES[id];
  if (kind === "Dynatrace platform service") return NAME.platformService;
  if (id.startsWith("dynatrace.")) return "Dynatrace app";
  return "Custom app";
}

const AGGREGATE_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and endsWith(event.type, " - Query")
| dedup event.id
{IN_PERIOD}
| fieldsAdd actor_kind = ${ACTOR_KIND}, source = ${SOURCE}
| fieldsRemove user.email
| summarize {billed_bytes = sum(billed_bytes), queries = count(), people = countDistinct(if(actor_kind == "Person", user.id)),
    last_record = max(timestamp)},
    by:{event.type, actor_kind, source}`;

/**
 * By person (v0.12.12): one row per person or account, with where their queries came
 * from. A stable code stands in for each person; the email is selected only when the
 * viewer chooses "Show names", is shown on screen only, and is never stored or logged.
 */
const personQuery = (reveal: boolean) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and endsWith(event.type, " - Query")
| dedup event.id
{IN_PERIOD}
| fieldsAdd actor_kind = ${ACTOR_KIND}, source = ${SOURCE},
    actor = substring(hashSha256(coalesce(user.id, "")), from: 0, to: 10)${reveal ? ",\n    person = user.email" : ""}
| fieldsRemove user.email, user.id
| summarize {billed_bytes = sum(billed_bytes), queries = count(), last_record = max(timestamp)},
    by:{event.type, actor_kind, actor, source${reveal ? ", person" : ""}}`;

/**
 * Which dashboard, notebook or workflow ran the queries (v0.12.11). Documents are
 * not people, so this is shown in every privacy mode. Dashboard and notebook titles
 * need a documents scope the app does not request: they show by ID with an Open
 * button; workflow titles come from the workflow billing records themselves.
 */
const DOCS_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and endsWith(event.type, " - Query")
| dedup event.id
{IN_PERIOD}
| fieldsAdd kind = if(isNotNull(client.workflow_context), "Workflow", else: if(client.application_context == "dynatrace.dashboards", "Dashboard", else: if(client.application_context == "dynatrace.notebooks", "Notebook", else: "")))
| filter kind != ""
| parse client.source, "LD UUIDSTRING:doc_id"
| fieldsAdd doc = if(kind == "Workflow", client.workflow_context, else: doc_id)
| fieldsRemove user.email, user.id
| summarize {billed_bytes = sum(billed_bytes), queries = count()}, by:{kind, doc, event.type}
| lookup [fetch dt.system.events, from: {BILLING_WINDOW}
    | filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Automation Workflow"
    | dedup workflow.id
    | fields workflow.id, wf_title = workflow.title],
  sourceField: doc, lookupField: workflow.id, fields: {wf_title}`;

const OPEN: Record<string, { app: string; page: (id: string) => string }> = {
  Dashboard: { app: "dynatrace.dashboards", page: (id) => `/dashboard/${id}` },
  Notebook: { app: "dynatrace.notebooks", page: (id) => `/notebook/${id}` },
  Workflow: { app: "dynatrace.automations", page: (id) => `/workflows/${id}` },
};

const GIB = 1073741824;
const MIN_GROUP = 5;
type Mode = "aggregate" | "person";
const SEARCH: FilterDef[] = [{ key: "q", label: "Name", kind: "search" }];

export const Queries = () => {
  const [params, setParams] = useSearchParams();
  // "pseudonymised" links from before v0.12.12 open the person view.
  const mode: Mode = ["person", "pseudonymised"].includes(params.get("privacy") ?? "") ? "person" : "aggregate";
  // Names are revealed for this visit only: not in the URL, so a shared link never shows them.
  const [reveal, setReveal] = useState(false);
  const setMode = (m: Mode) => {
    const p = new URLSearchParams(params);
    p.set("privacy", m);
    setParams(p);
  };
  const q = useBillingQuery(mode === "aggregate" ? AGGREGATE_QUERY : personQuery(reveal));
  const rates = useRates();
  const period = usePeriod();
  const href = useAppHref();
  const f = useFilters(SEARCH);

  const { items, hiddenPeople, last, total, sources } = useMemo(() => {
    const byKey = new Map<string, { name: string; sourceId?: string; detail: string; bytes: number; queries: number; cost: number | null; unpricedBytes: number; notCharged: boolean; from: Map<string, number> }>();
    let hidden = 0;
    let newest: string | null = null;
    let sum = 0;
    const src = new Set<RateSource>();
    for (const r of q.records ?? []) {
      if (!r) continue;
      const bytes = asNumber(r.billed_bytes);
      const eventType = String(r["event.type"]);
      const rate = rates.rateFor(eventType);
      if (rate) src.add(rate.source);
      const cost = rate ? (bytes / GIB) * rate.value : null;
      sum += bytes;
      if (typeof r.last_record === "string" && (!newest || r.last_record > newest)) newest = r.last_record;
      const kind = String(r.actor_kind);
      let key: string;
      let name: string;
      let detail: string;
      if (mode === "aggregate") {
        const source = String(r.source);
        if (kind === "Person" && asNumber(r.people) < MIN_GROUP) {
          // Pooled into one row with no source named (v0.12.40): the rows still add up to the
          // total, and no group under five people can be picked out.
          hidden += bytes;
          key = "pooled";
          name = NAME.smallGroups;
          detail = `Groups under ${MIN_GROUP} people, pooled`;
        } else if (kind === "Dynatrace platform service") {
          // One row: the services' own IDs are Dynatrace's internal names, not something to act on.
          key = "platform";
          name = NAME.platformService;
          detail = "Queries Dynatrace runs for you, such as problem detection";
        } else {
          key = `${kind}|${source}`;
          name = sourceName(source, kind);
          detail = kind === "Person" ? `People (${asNumber(r.people)})` : kind;
        }
      } else {
        key = `${kind}|${String(r.actor)}`;
        const shown = reveal && typeof r.person === "string" && r.person ? r.person : null;
        name = shown ?? (kind === "Person" ? `Person ${String(r.actor)}` : kind === "System and automation" ? kind : `${kind} ${String(r.actor)}`);
        detail = kind;
      }
      const sourceId = mode === "aggregate" && key !== "pooled" && key !== "platform" && String(r.source) && !KNOWN_SOURCES[String(r.source)] ? String(r.source) : undefined;
      const e = byKey.get(key) ?? { name, sourceId, detail, bytes: 0, queries: 0, cost: null, unpricedBytes: 0, notCharged: false, from: new Map<string, number>() };
      if (mode === "person") {
        const from = sourceName(String(r.source), String(r.actor_kind));
        e.from.set(from, (e.from.get(from) ?? 0) + bytes);
      }
      e.bytes += bytes;
      e.queries += asNumber(r.queries);
      // Priced part summed; the rest kept as GiB, named "not charged" when Dynatrace doesn't charge it yet.
      if (cost === null) {
        e.unpricedBytes += bytes;
        if (NOT_CHARGED[eventType]) e.notCharged = true;
      } else e.cost = (e.cost ?? 0) + cost;
      byKey.set(key, e);
    }
    const list: RankedItem[] = [...byKey.entries()].map(([id, e]) => ({
      id,
      name: e.name,
      entityId: e.sourceId,
      // Two internal services share a name; the last part of their ID tells them apart.
      disambiguator: e.sourceId ? e.sourceId.split(".").pop() : e.detail,
      detail: e.detail,
      value: e.bytes / GIB,
      extras:
        `${e.queries.toLocaleString(appLocale())} billed queries${e.cost !== null ? `, ${formatCost(e.cost, rates.currency)}` : ""}` +
        (e.unpricedBytes > 0 ? `, ${formatQuantity(e.unpricedBytes / GIB)} GiB ${e.notCharged ? "not charged (Early Access)" : "with no price"}` : "") +
        // By person: where their scanning came from, largest first (what to look at with them).
        (e.from.size
          ? `; from ${[...e.from.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, b]) => `${n} (${formatQuantity(b / GIB)} GiB)`).join(", ")}`
          : ""),
    }));
    return { items: list, hiddenPeople: hidden, last: newest, total: sum, sources: src };
  }, [q.records, mode, rates, reveal]);
  const shownItems = items.filter((i) => matches(`${i.name} ${i.detail ?? ""}`, f.values.q));

  // Groups of fewer than five people are pooled out of By source; when they hold most of the
  // scanning, the headline must say so rather than rank the small remainder.
  const hiddenShare = total > 0 ? hiddenPeople / total : 0;
  const [rankSetup, rankConclusion] = concentrationAnswer(
    items.map((i) => i.value),
    { one: mode === "aggregate" ? "source" : "person or account", many: mode === "aggregate" ? "sources" : "people and accounts" },
    "query scanning",
  );
  const [setup, conclusion] =
    mode === "aggregate" && hiddenShare >= 0.5
      ? [hiddenShare > 0.995 ? "Almost all query scanning" : `${Math.round(hiddenShare * 100)}% of query scanning`, `comes from sources used by fewer than ${MIN_GROUP} people each.`]
      : [rankSetup, rankConclusion];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome
        query={q.query}
        records={q.records}
        error={q.error}
        errorKind={q.errorKind}
        partial={q.partial}
        isLoading={q.isLoading}
        retry={q.retry} cancel={q.cancel} cancelled={q.cancelled}
        empty={`No query usage was billed in ${period.phrase}.`}
        skeleton={<Bone w="100%" h={300} r={14} />}
      >
        <Answer
          setup={items.length > 0 || hiddenShare >= 0.5 ? setup : "No sources"}
          conclusion={items.length > 0 || hiddenShare >= 0.5 ? conclusion : "to show in this view."}
          lead={`Billed query scanning in ${period.phrase}: ${formatQuantity(total / GIB)} GiB scanned. Ranked by GiB scanned${sources.size ? `; costs in the rows: ${sourcesLabel(sources)}` : ""}.`}
          delta={<PeriodDelta filter={`endsWith(event.type, " - Query")`} quantity="toDouble(billed_bytes) / 1073741824" unit="GiB scanned" />}
        />
        <DataAsOf last={last} />
        {/* The shared toolbar (v0.12.32): By source / By person is how the list is grouped; a name search on the right. */}
        <Toolbar<Mode>
          group={{
            value: mode,
            onChange: setMode,
            options: [
              { value: "aggregate", label: "By source" },
              { value: "person", label: "By person" },
            ],
          }}
          defs={SEARCH}
          f={f}
          trailing={
            <>
              {mode === "person" && (
                <SecondaryButton onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
                  {reveal ? "Hide names" : "Show names"}
                </SecondaryButton>
              )}
              <Info
                label="By source and by person"
                guide={{
                  what: "By source: the apps, dashboards and service accounts whose queries you pay for; people are pooled per app, and groups under 5 people are hidden. By person: one row per person or account, with where their queries came from.",
                  why: "Query cost is the one cost Dynatrace bills with a person attached. Only query billing names a person; hosts, Kubernetes, monitoring and storage never do.",
                  how: "A stable code stands in for each person. Show names reveals emails on screen for this visit only; they are never saved or sent anywhere.",
                }}
              />
            </>
          }
        />
        {mode === "person" && (
          <span style={{ ...type.body, color: color.textTertiary }}>
            People may not want their names ranked in front of others: show names only when you need them.
          </span>
        )}
        <RankedRows items={shownItems} unit="GiB scanned" itemLabel={mode === "aggregate" ? "Source" : "Person or account"} href={href} />
        <CsvDownload
          name={mode === "aggregate" ? "query-sources" : "query-people-pseudonymised"}
          noun={mode === "aggregate" ? "sources" : "people and accounts"}
          rows={[...shownItems].sort((a, b) => b.value - a.value)}
          columns={[
            // By person exports the stable code even while names are shown: a file outlives the visit.
            { header: mode === "aggregate" ? "Source" : "Person or account (pseudonymised code)", value: (i) => (mode === "aggregate" ? i.name : i.id.replace("|", " ")) },
            { header: "Details", value: (i) => i.detail ?? null },
            { header: "GiB scanned", value: (i) => i.value },
            { header: "Notes", value: (i) => i.extras ?? null },
          ]}
        />
        {hiddenPeople > 0 && (
          <span style={{ ...type.body, color: color.textTertiary }}>
            Small groups of people: {formatQuantity(hiddenPeople / GIB)} GiB from groups of fewer than {MIN_GROUP} people,
            pooled into one row so a small group can't be singled out. By person shows each one.
          </span>
        )}
      </QueryOutcome>
      <Documents />
      <NextSteps links={[{ to: R.fixes, label: "Check log retention and query costs" }, { to: R.entities("buckets"), label: "See what each bucket stores" }]} />
      <ShowQuery query={q.query} />
    </div>
  );
};

/** The dashboards, notebooks and workflows whose queries scan the most, each with a way to open it. */
function Documents() {
  const q = useBillingQuery(DOCS_QUERY);
  const rates = useRates();
  const { rows, sources } = useMemo(() => {
    const m = new Map<string, { kind: string; id: string; title: string | null; bytes: number; queries: number; cost: number; unpriced: number }>();
    const src = new Set<RateSource>();
    for (const r of q.records ?? []) {
      if (!r || typeof r.doc !== "string" || !r.doc) continue;
      const key = `${String(r.kind)}|${r.doc}`;
      const rate = rates.rateFor(String(r["event.type"]));
      if (rate) src.add(rate.source);
      const bytes = asNumber(r.billed_bytes);
      const e = m.get(key) ?? { kind: String(r.kind), id: r.doc, title: typeof r.wf_title === "string" ? r.wf_title : null, bytes: 0, queries: 0, cost: 0, unpriced: 0 };
      e.bytes += bytes;
      e.queries += asNumber(r.queries);
      // One unpriced type (DEM Query) no longer wipes out the priced part.
      if (rate) e.cost += (bytes / GIB) * rate.value;
      else e.unpriced += bytes;
      m.set(key, e);
    }
    return { rows: [...m.values()].sort((a, b) => b.bytes - a.bytes), sources: src };
  }, [q.records, rates]);
  const pager = usePager(rows.length);
  if (q.isLoading) return <Bone w="100%" h={120} r={14} />;
  if (q.error) return null;
  return (
    <section aria-label="Dashboards, notebooks and workflows" style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <span style={{ display: "flex", alignItems: "center", gap: space[12], flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, ...type.title }}>Dashboards, notebooks and workflows</h2>
        {sources.size > 0 && <PriceTag sources={sources} />}
      </span>
      {rows.length === 0 ? (
        <span style={{ ...type.body, color: color.textSecondary }}>No billed queries came from a dashboard, notebook or workflow in this timeframe.</span>
      ) : (
        <div role="table" aria-label="Queries by dashboard, notebook and workflow" style={{ display: "flex", flexDirection: "column" }}>
          <div role="row" style={{ ...docGrid, padding: `0 ${space[8]}px ${space[8]}px` }}>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary }}>Source</span>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>GiB scanned</span>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>Cost</span>
            <span role="columnheader">
              <span className="lc-visually-hidden">Open</span>
            </span>
          </div>
          {rows.slice(0, pager.shown).map((d) => (
            <div key={`${d.kind}|${d.id}`} role="row" style={{ ...docGrid, padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
              <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
                <span style={{ ...type.heading, overflowWrap: "anywhere" }}>{d.title ?? d.kind}</span>
                <span style={{ ...type.mono, color: color.textTertiary }}>{d.kind === "Workflow" && d.title ? `Workflow ${d.id}` : d.id}</span>
                <span style={{ ...type.body, color: color.textTertiary }}>{d.queries.toLocaleString(appLocale())} billed queries</span>
              </span>
              <span role="cell" style={{ ...type.body, textAlign: "right" }}>{formatQuantity(d.bytes / GIB)}</span>
              <span role="cell" style={{ ...type.body, textAlign: "right" }}>{d.unpriced >= d.bytes ? "Not charged yet" : formatCost(d.cost, rates.currency)}
                {d.unpriced > 0 && d.unpriced < d.bytes ? <span style={{ display: "block", color: color.textTertiary }}>plus {formatQuantity(d.unpriced / GIB)} GiB not charged</span> : null}
              </span>
              <span role="cell" style={{ textAlign: "right" }}>
                <SecondaryButton onClick={() => openApp(OPEN[d.kind].app, OPEN[d.kind].page(d.id))} aria-label={`Open ${d.kind.toLowerCase()} ${d.title ?? d.id}`}>
                  Open
                </SecondaryButton>
              </span>
            </div>
          ))}
          {pager.needed && <PagerFooter pager={pager} noun="sources" filterHint={false} />}
        </div>
      )}
      <span style={{ ...type.body, color: color.textTertiary }}>
        Dashboard and notebook names need a permission this app does not request, so they show by ID. Open one to see its name, and narrow its timeframe or add a bucket filter to scan less.
      </span>
    </section>
  );
}

const docGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(240px, 2fr) 120px 120px 96px", gap: space[16], alignItems: "center" };
