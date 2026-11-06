import React, { useEffect, useRef, type ReactNode } from "react";
import { appLocale } from "../locale";
import { Link, useSearchParams } from "react-router-dom";

import { color, radius, space, type } from "../design/tokens";
import { Answer, Label, SignalLabel } from "../design/primitives";
import { EntityIdLine, disambiguate, displayName, nameState } from "../components/EntityName";
import { Bone, DataAsOf, ENTITY_RESULT_RECORDS, QueryOutcome, ShowQuery, asNumber, useAppHref, useBillingQuery, usePeriod } from "../components/shared";
import { R } from "../routes";
import { useClassicEntitiesMissing } from "../data/entities";
import { MSG } from "../strings";
import { PriceTag } from "../components/Tags";
import { COST_CENTRE_FIELDS } from "../funnel";
import { PagerFooter, usePager } from "../components/RankedList";
import { CsvDownload } from "../components/CsvDownload";
import { SOURCE_LABEL, formatCost, formatQuantity, moneyAt, sourcesLabel, useRates, type RateSource, type Rates } from "../rates";

import { NextSteps } from "../components/NextSteps";
/**
 * Findings. Advice only: every lever says what was
 * found, why it matters, how to fix it (numbered steps and a documentation
 * link), the trade-off, who acts and when. "Worth reviewing", never "remove".
 * Each lever has its own query, so one failure does not hide the others.
 * Money appears only with a rate and is labelled with its source; savings are
 * ranges where the billing rules leave room (15-minute intervals).
 */
const GIB = 1073741824;
const FSM = "Full-Stack Monitoring";
const INFRA = "Infrastructure Monitoring";
const RVA = "Runtime Vulnerability Analytics";
const RAP = "Runtime Application Protection";
const WORKFLOW = "Automation Workflow";
const LOG_RETAIN = "Log Management & Analytics - Retain";
const LOG_RWIQ = "Log Management & Analytics - Retain with Included Queries";
const LOG_QUERY = "Log Management & Analytics - Query";

/** Hosts: Full-Stack memory, the hours it ran, security add-ons, cost tags, services. */
const HOSTS_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter event.type == "${FSM}"
| dedup event.id
{IN_PERIOD}
| fieldsAdd host_id = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host_id)
| summarize {fsm = sum(if(event.type == "${FSM}", billed_gibibyte_hours)),
    n_fsm = countIf(event.type == "${FSM}"),
    fsm_slots = countDistinctExact(if(event.type == "${FSM}", bin(coalesce(toTimestamp(usage.start), timestamp), 15m))),
    fsm_hours = countDistinctExact(if(event.type == "${FSM}", bin(coalesce(toTimestamp(usage.start), timestamp), 1h))),
    last_record = max(timestamp),
    last_fsm = max(if(event.type == "${FSM}", timestamp))},
    by:{host_id}
| lookup [fetch dt.entity.host | fields id, entity.name, hostGroupName], sourceField: host_id, lookupField: id, prefix: "host."
| lookup [fetch dt.entity.service | fields sid = id, h = runs_on[dt.entity.host] | expand h | summarize services = countDistinct(sid), by:{h}],
    sourceField: host_id, lookupField: h, prefix: "svc."`;

/** Security add-ons per host (their own query, so the Full-Stack lever does not depend on it). */
const SECURITY_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter in(event.type, {"${RVA}", "${RAP}"})
| dedup event.id
{IN_PERIOD}
| fieldsAdd host_id = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host_id)
| summarize {rva = sum(if(event.type == "${RVA}", billed_gibibyte_hours)), rap = sum(if(event.type == "${RAP}", billed_gibibyte_hours))}, by:{host_id}
| lookup [fetch dt.entity.host | fields id, entity.name], sourceField: host_id, lookupField: id, prefix: "host."`;

/** Cost centre per billed host, with the host's own tags. */
const TAGS_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
{IN_PERIOD}
| fieldsAdd host_id = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host_id)
${COST_CENTRE_FIELDS}
| summarize {tagged = countIf(isNotNull(cost_centre)), last_record = max(timestamp)}, by:{host_id}
| lookup [fetch dt.entity.host | fields id, entity.name, tags], sourceField: host_id, lookupField: id, prefix: "host."`;

/** Standard workflows bill one workflow-hour for every hour they exist; executions come from workflow events. */
const WORKFLOWS_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "${WORKFLOW}"
| dedup event.id
{IN_PERIOD}
| summarize {hours = count(), title = takeLast(workflow.title), trigger = takeLast(workflow.trigger_type), last_record = max(timestamp)},
    by:{workflow.id}
| lookup [fetch dt.system.events, from: {TIMEFRAME}
    | filter event.kind == "WORKFLOW_EVENT" and event.type == "WORKFLOW_EXECUTION"
    | summarize runs = countDistinct(dt.automation_engine.workflow_execution.id), by:{wid = dt.automation_engine.workflow.id}],
  sourceField: workflow.id, lookupField: wid, prefix: "exec."`;

/** Retain records are hourly snapshots of stored bytes: the sum is byte-hours. */
const RETAIN_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter endsWith(event.type, " - Retain") or event.type == "${LOG_RWIQ}"
| dedup event.id
{IN_PERIOD}
| summarize {byte_hours = sum(billed_bytes), last_record = max(timestamp)}, by:{usage.bucket, event.type}`;

/** Query executions per bucket. Only the bucket and byte counts leave Grail. */
const SCANS_QUERY = `fetch dt.system.events, from: {TIMEFRAME}
| filter event.kind == "QUERY_EXECUTION_EVENT" and isNotNull(bucket) and bucket != ""
| summarize {queries = count(), on_demand = sum(scanned_bytes.on_demand), included = sum(scanned_bytes.included)}, by:{bucket}`;

/** Billed log query bytes for the whole period (not split per bucket by Dynatrace). */
const LOG_QUERY_BILLED = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "${LOG_QUERY}"
| dedup event.id
{IN_PERIOD}
| summarize {billed_bytes = sum(billed_bytes), n = count()}`;

const REPLAY_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter in(event.type, {"Real User Monitoring", "Real User Monitoring with Session Replay"})
| dedup event.id
{IN_PERIOD}
| summarize {sessions = sum(billed_sessions), replays = sum(billed_replay_sessions)},
    by:{app_id = coalesce(dt.entity.application, dt.entity.device_application, toString(dt.smartscape.frontend))}
| lookup [fetch dt.entity.application | fields id, entity.name], sourceField: app_id, lookupField: id, prefix: "app."
| lookup [fetch dt.entity.mobile_application | fields id, entity.name], sourceField: app_id, lookupField: id, prefix: "mob."`;

const NAMESPACES_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Kubernetes Platform Monitoring"
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| summarize {pod_hours = sum(billed_pod_hours), tagged = countIf(isNotNull(cost_centre))},
    by:{ns_id = coalesce(dt.entity.cloud_application_namespace, toString(dt.smartscape.k8s_namespace))}
| lookup [fetch dt.entity.cloud_application_namespace | fields id, entity.name], sourceField: ns_id, lookupField: id, prefix: "ns."`;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString(appLocale())} ${n === 1 ? one : many}`;
/** Buckets averaging less than this are too small to be worth anyone's time. */
const MIN_BUCKET_GIB = 1;

type Status = "review" | "clear" | "noSaving";
type Entity = { id: string; name: string; facts: string };
type Lever = {
  key: string;
  title: string;
  status: Status;
  found: string;
  entities: Entity[];
  why: string;
  steps: string[];
  link: { label: string; url: string };
  tradeOff: string;
  who: string;
  when: string;
  /** Upper end of the money at stake in this period, for the headline; null when unpriced. */
  upTo: number | null;
  /** Lower end of the same estimate; equal to upTo when the figure is a cost already incurred. */
  from?: number | null;
  /** Extra evidence shown under the entities, e.g. the bucket utility table. */
  more?: ReactNode;
  /** True when this lever shows money; it then carries the rate-source label. */
  priced?: boolean;
  /** Set when this environment can't support the check; it is then not counted as checked. */
  unavailable?: string;
};

function money(rates: Rates, value: number) {
  return formatCost(value, rates.currency);
}

/**
 * The Findings's one total (WORDING AND CLAIMS): a range, its layer, its basis, and what
 * could make it wrong. Never "will save".
 */
export function estimateSentence(rates: Rates, lo: number, hi: number, sources: Set<RateSource>): string {
  // When the bounds meet, the honest range is "nothing up to this": how much changes depends on what is acted on.
  const span = Math.abs(hi - lo) < 0.005 ? `$0 to about ${money(rates, hi)}` : `${money(rates, Math.max(0, lo))} to ${money(rates, hi)}`;
  return `Estimated difference if every priced finding were acted on: ${span} for a timeframe like this, at ${lowerFirst(sourcesLabel(sources))}. Based on usage in this timeframe. It is $0 for anything still needed, such as a workflow that runs monthly or from the API; memory rounding, query volume and your contract rate also change it.`;
}

const lowerFirst = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

function range(rates: Rates, lo: number, hi: number) {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.max(0, Math.max(lo, hi));
  return Math.abs(b - a) < 0.005 ? `$0 to about ${money(rates, b)}` : `${money(rates, a)} to ${money(rates, b)}`;
}

/** Every lever's query returns one compact row per entity. */
const BIG = { maxRecords: ENTITY_RESULT_RECORDS };

/** Every lever checked against billing (v0.12.8: shared with the Home summary, so both show the same findings). */
export function useFixList() {
  const noClassic = useClassicEntitiesMissing();
  // One query per lever, so one failure blanks only its own section.
  const hosts = useBillingQuery(HOSTS_QUERY, BIG);
  const security = useBillingQuery(SECURITY_QUERY, BIG);
  const tags = useBillingQuery(TAGS_QUERY, BIG);
  const workflows = useBillingQuery(WORKFLOWS_QUERY, BIG);
  const retain = useBillingQuery(RETAIN_QUERY, BIG);
  const scans = useBillingQuery(SCANS_QUERY, BIG);
  const logQueryBilled = useBillingQuery(LOG_QUERY_BILLED);
  const replay = useBillingQuery(REPLAY_QUERY, BIG);
  const namespaces = useBillingQuery(NAMESPACES_QUERY, BIG);
  const rates = useRates();
  const period = usePeriod();
  const href = useAppHref();
  const days = Math.max(1, (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 86400000);
  const sources = new Set<RateSource>();
  const rate = (t: string) => {
    const r = rates.rateFor(t);
    return r ? r.value : null;
  };
  const used = (...types: string[]) => {
    for (const t of types) {
      const r = rates.rateFor(t);
      if (r) sources.add(r.source);
    }
  };

  // ---- Hosts: Full-Stack that could run Infrastructure; RVA/RAP stacked; untagged.
  const hostRows = (hosts.records ?? []).flatMap((r) => {
    if (!r || typeof r.host_id !== "string") return [];
    return [
      {
        id: r.host_id,
        name: displayName(str(r["host.entity.name"]), "host", nameState(r["host.id"], r["host.entity.name"])),
        fsm: asNumber(r.n_fsm) > 0 ? asNumber(r.fsm) : null,
        slots: asNumber(r.fsm_slots),
        hours: asNumber(r.fsm_hours),
        // A host with no Full-Stack record in the last 3 days of the period is gone or
        // switched already; it has no services in the entity table, so it is not a candidate.
        gone: typeof r.last_fsm === "string" && Date.parse(period.toIso) - Date.parse(r.last_fsm) > 3 * 86400000,
        services: r["svc.services"] === null || r["svc.services"] === undefined ? 0 : asNumber(r["svc.services"]),
      },
    ];
  });
  const stacked = (security.records ?? []).flatMap((r) => {
    if (!r || typeof r.host_id !== "string") return [];
    const rva = asNumber(r.rva);
    const rap = asNumber(r.rap);
    return rva > 0 || rap > 0
      ? [{ id: r.host_id, name: displayName(str(r["host.entity.name"]), "host", nameState(r["host.id"], r["host.entity.name"])), rva, rap }]
      : [];
  });
  const tagRows = (tags.records ?? []).flatMap((r) => {
    if (!r || typeof r.host_id !== "string") return [];
    return [
      {
        id: r.host_id,
        name: displayName(str(r["host.entity.name"]), "host", nameState(r["host.id"], r["host.entity.name"])),
        tagged: asNumber(r.tagged) > 0,
        tagOnHost: Array.isArray(r["host.tags"]) && (r["host.tags"] as unknown[]).some((t) => typeof t === "string" && t.includes("dt.cost.costcenter")),
      },
    ];
  });
  const rFsm = rate(FSM);
  const rInfra = rate(INFRA);
  const mixedInfraSources = Boolean(rates.rateFor(FSM) && rates.rateFor(INFRA) && rates.rateFor(FSM)!.source !== rates.rateFor(INFRA)!.source);
  const noServices = hostRows.filter((h) => h.fsm !== null && h.services === 0 && !h.gone);
  const goneHosts = hostRows.filter((h) => h.fsm !== null && h.services === 0 && h.gone).length;
  const infraCandidates = noServices.map((h) => {
    const avgGib = h.hours > 0 ? (h.fsm ?? 0) / (h.slots / 4 || h.hours) : 0;
    let saving: [number, number] | null = null;
    if (rFsm !== null && rInfra !== null) {
      const fsmCost = (h.fsm ?? 0) * rFsm;
      // Infrastructure is billed per host-hour in 15-minute intervals: between the
      // intervals actually billed (slots / 4) and every clock hour touched.
      saving = [fsmCost - h.hours * rInfra, fsmCost - (h.slots / 4) * rInfra];
    }
    return { ...h, avgGib, saving };
  });
  const infraWorth = infraCandidates.filter((h) => h.saving === null || h.saving[1] > 0.005);
  const infraNone = infraCandidates.filter((h) => h.saving !== null && h.saving[1] <= 0.005);
  if (infraWorth.some((h) => h.saving)) used(FSM, INFRA);

  if (stacked.length) used(RVA, RAP);
  const untaggedHosts = tagRows.filter((h) => !h.tagged);
  const tagNotReaching = untaggedHosts.filter((h) => h.tagOnHost);

  // ---- Workflows billed with no executions.
  const rWf = rate(WORKFLOW);
  const noRuns = (workflows.records ?? []).flatMap((r) => {
    if (!r || typeof r["workflow.id"] !== "string") return [];
    if (asNumber(r["exec.runs"]) > 0) return [];
    return [{ id: r["workflow.id"], name: str(r.title) ?? "Unnamed workflow", hours: asNumber(r.hours), trigger: str(r.trigger) }];
  });
  // An event-triggered workflow that never fired is waiting, not idle: listed, not priced as a saving.
  const idle = noRuns.filter((w) => w.trigger !== "event");
  const waiting = noRuns.filter((w) => w.trigger === "event");
  if (idle.length && rWf !== null) used(WORKFLOW);

  // ---- Buckets: stored volume against query volume.
  const scanBy = new Map<string, { queries: number; onDemand: number; included: number }>();
  for (const r of scans.records ?? []) {
    if (r && typeof r.bucket === "string")
      scanBy.set(r.bucket, { queries: asNumber(r.queries), onDemand: asNumber(r.on_demand), included: asNumber(r.included) });
  }
  const buckets = (retain.records ?? []).flatMap((r) => {
    if (!r || typeof r["usage.bucket"] !== "string") return [];
    const gibDays = asNumber(r.byte_hours) / GIB / 24;
    const s = scanBy.get(r["usage.bucket"]) ?? { queries: 0, onDemand: 0, included: 0 };
    return [{ name: r["usage.bucket"], type: String(r["event.type"]), gibDays, avgGib: gibDays / days, ...s }];
  });
  const material = buckets.filter((b) => b.avgGib >= MIN_BUCKET_GIB);
  const tiny = buckets.length - material.length;
  const rarely = material.filter((b) => b.queries < days);
  const rarelyCost = rarely.reduce((a, b) => {
    const rr = rate(b.type);
    return rr === null ? a : a + b.gibDays * rr;
  }, 0);
  if (rarely.some((b) => rate(b.type) !== null)) used(...rarely.map((b) => b.type));

  const rRetain = rate(LOG_RETAIN);
  const rRwiq = rate(LOG_RWIQ);
  const rQuery = rate(LOG_QUERY);
  const logBuckets = material.filter((b) => b.type === LOG_RETAIN || b.type === LOG_RWIQ);
  const modelChecks =
    rRetain !== null && rRwiq !== null && rQuery !== null
      ? logBuckets.map((b) => {
          const usageBased = b.gibDays * rRetain + ((b.onDemand + b.included) / GIB) * rQuery;
          const included = b.gibDays * rRwiq;
          return { ...b, usageBased, included, onRwiq: b.type === LOG_RWIQ };
        })
      : [];
  // Usage-based query cost is an upper bound (scan-skipped data is billed at a 98% discount).
  const switchWorth = modelChecks.filter((b) => (b.onRwiq ? b.usageBased < b.included : b.included < b.usageBased));
  if (modelChecks.length) used(LOG_RETAIN, LOG_RWIQ, LOG_QUERY);
  const billedLogQueryGib = (() => {
    const r = logQueryBilled.records?.[0];
    return r && asNumber(r.n) > 0 ? asNumber(r.billed_bytes) / GIB : null;
  })();
  const scannedLogGib = logBuckets.reduce((a, b) => a + (b.onDemand + b.included) / GIB, 0);

  // ---- Session Replay share per application.
  const replayApps = (replay.records ?? []).flatMap((r) => {
    if (!r || typeof r.app_id !== "string" || asNumber(r.replays) <= 0) return [];
    return [
      {
        id: r.app_id,
        name: displayName(str(r["app.entity.name"]) ?? str(r["mob.entity.name"]), "application", nameState(r["app.id"] ?? r["mob.id"], r["app.entity.name"] ?? r["mob.entity.name"])),
        sessions: asNumber(r.sessions),
        replays: asNumber(r.replays),
      },
    ];
  });

  // ---- Namespaces without a cost centre (only those that billed pod-hours).
  const untaggedNs = (namespaces.records ?? []).flatMap((r) => {
    if (!r || asNumber(r.pod_hours) <= 0 || asNumber(r.tagged) > 0) return [];
    const id = String(r.ns_id);
    return [{ id, name: displayName(str(r["ns.entity.name"]), "namespace", nameState(r["ns.id"], r["ns.entity.name"])), podHours: asNumber(r.pod_hours) }];
  });

  const tinyLog = buckets.filter((b) => (b.type === LOG_RETAIN || b.type === LOG_RWIQ) && b.avgGib < MIN_BUCKET_GIB).length;
  const tinyLogNote = tinyLog > 0 ? ` ${plural(tinyLog, "log bucket", "log buckets")} under ${MIN_BUCKET_GIB} GiB on average ${tinyLog === 1 ? "is" : "are"} left out.` : "";
  const tinyNote = tiny > 0 ? ` ${plural(tiny, "bucket", "buckets")} under ${MIN_BUCKET_GIB} GiB on average ${tiny === 1 ? "is" : "are"} left out.` : "";

  const levers: Lever[] = [
    {
      key: "infra",
      title: "Full-Stack hosts with no detected service",
      status: infraWorth.length ? "review" : infraNone.length ? "noSaving" : "clear",
      found: infraCandidates.length
        ? `${infraCandidates.length} of ${hostRows.filter((h) => h.fsm !== null).length} Full-Stack hosts run no detected service, so the traces and code-level data that Full-Stack adds over Infrastructure may not be in use on them.` +
          (infraNone.length
            ? ` ${infraNone.length} of them ${infraNone.length === 1 ? "is" : "are"} small enough that, at the rates in use, Full-Stack is estimated to cost no more than Infrastructure would.`
            : "") +
          (goneHosts ? ` ${plural(goneHosts, "host", "hosts")} that stopped billing before the period ended ${goneHosts === 1 ? "is" : "are"} left out.` : "") +
          (mixedInfraSources ? ` Full-Stack is priced at ${SOURCE_LABEL[rates.rateFor(FSM)!.source].toLowerCase()} and Infrastructure at ${SOURCE_LABEL[rates.rateFor(INFRA)!.source].toLowerCase()}, so the comparison mixes rate sources.` : "")
        : `Every Full-Stack host runs at least one detected service.${goneHosts ? ` ${plural(goneHosts, "host", "hosts")} that stopped billing before the period ended ${goneHosts === 1 ? "is" : "are"} left out.` : ""}`,
      entities: infraWorth.map((h) => ({
        id: h.id,
        name: h.name,
        facts:
          `${formatQuantity(h.fsm ?? 0)} GiB-hours of Full-Stack over ${formatQuantity(h.hours)} hours, about ${formatQuantity(h.avgGib)} GiB on average. No services detected.` +
          (h.saving ? ` Estimated difference at the rates in use: ${range(rates, h.saving[0], h.saving[1])} for a timeframe like this if the host ran Infrastructure Monitoring. Memory rounding or a different contract rate changes it.` : ""),
      })),
      why:
        rFsm !== null && rInfra !== null
          ? `Full-Stack is billed per GiB-hour of host memory (rounded up to 0.25 GiB, 4 GiB minimum per the billing rules); Infrastructure per host-hour. At the rates in use a host with more than ${formatQuantity(rInfra / rFsm)} GiB costs more on Full-Stack; a different contract moves that line.`
          : "Full-Stack is billed per GiB-hour of host memory (rounded up to 0.25 GiB, 4 GiB minimum); Infrastructure per host-hour. No price for one of them, so the saving is shown in native units only.",
      steps: [
        "Confirm with the host's team that traces and code-level data from it are not in use.",
        "Open the host in Hosts Classic, then More (…) > Settings > Host monitoring > Monitoring mode.",
        "Choose Infrastructure and save. Or on the host run: oneagentctl --set-monitoring-mode=infra-only --restart-service.",
        "Restart the monitored processes so the change takes effect.",
      ],
      link: { label: "Enable OneAgent monitoring modes", url: "https://docs.dynatrace.com/docs/platform/oneagent/monitoring-modes/enable-monitoring-modes" },
      tradeOff: "You lose traces and code-level data on that host. Reversible; the agent must be connected, and processes restart.",
      who: "The host's owning team, with the Dynatrace administrator.",
      when: "Next maintenance window. Takes effect on restart; not retroactive.",
      upTo: infraWorth.reduce((a, h) => a + (h.saving ? Math.max(0, h.saving[1]) : 0), 0) || null,
      from: infraWorth.reduce((a, h) => a + (h.saving ? Math.max(0, h.saving[0]) : 0), 0),
      priced: infraWorth.some((h) => h.saving) || (rFsm !== null && rInfra !== null),
    },
    {
      key: "idle",
      title: "Standard workflows billed with no runs",
      status: idle.length ? "review" : "clear",
      found:
        (idle.length
          ? `${plural(idle.length, "workflow was", "workflows were")} billed for workflow-hours in ${period.phrase} with no runs.`
          : `Every billed scheduled or manual workflow ran at least once in ${period.phrase}.`) +
        (idle.length && days < 28 ? " A workflow that runs weekly or monthly can look idle in a period this short, so no saving is added up; choose 30 days or more for a fuller picture." : "") +
        (waiting.length
          ? ` ${plural(waiting.length, "event-triggered workflow", "event-triggered workflows")} also had no runs; ${waiting.length === 1 ? "it is" : "they are"} waiting for ${waiting.length === 1 ? "its" : "their"} trigger and not counted as a saving.`
          : ""),
      entities: [
        ...idle.map((w) => ({
          id: w.id,
          name: w.name,
          facts:
            `${formatQuantity(w.hours)} workflow-hours billed, 0 runs${w.trigger ? `, trigger: ${w.trigger}` : ""}.` +
            (rWf !== null
              ? ` Those hours cost about ${moneyAt(w.hours * rWf, rates.currency, rates.rateFor(WORKFLOW)?.source)} in this timeframe${Math.abs(days - 30) > 1 ? `; about ${money(rates, 24 * 30 * rWf)} per 30 days while it stays deployed` : ""}.`
              : ""),
        })),
        ...waiting.map((w) => ({
          id: w.id,
          name: w.name,
          facts: `${formatQuantity(w.hours)} workflow-hours billed, 0 runs, waiting for its event trigger${rWf !== null ? `; estimated ${moneyAt(w.hours * rWf, rates.currency, rates.rateFor(WORKFLOW)?.source)} for this timeframe` : ""}.`,
        })),
      ],
      why: "A standard workflow is billed one workflow-hour for every hour it exists, whether it runs or not. Simple workflows and drafts are not billed workflow-hours.",
      steps: [
        "Ask the workflow's owner whether it is still needed.",
        "If it has one task, rebuild it as a simple workflow.",
        "If it is not needed now, undeploy it back to a draft (Workflows > open it > undeploy).",
      ],
      link: { label: "Automation Workflow consumption", url: "https://docs.dynatrace.com/docs/license/capabilities/automation/automation" },
      tradeOff: "Undeploying stops its triggers until it is deployed again. A simple workflow allows only one task.",
      who: "The workflow's owner.",
      when: "Any time. Billing for it should stop from the next billed hour after it is undeployed.",
      // A workflow that runs monthly looks idle in a short window: price the saving only over 28 days or more.
      upTo: idle.length && rWf !== null && days >= 28 ? idle.reduce((a, w) => a + w.hours * rWf, 0) : null,
      priced: idle.length > 0 && rWf !== null,
    },
    {
      key: "buckets",
      title: "Buckets stored for longer than they are queried",
      status: rarely.length ? "review" : "clear",
      found: rarely.length
        ? `${rarely.length} of ${plural(material.length, "retained bucket", "retained buckets")} ${rarely.length === 1 ? "was" : "were"} queried less than once a day on average in ${period.phrase}.${tinyNote}${days < 28 ? " A short timeframe can make a bucket look rarely queried; 30 days or more gives a fuller picture." : ""}`
        : `Every retained bucket was queried at least once a day on average in ${period.phrase}.${tinyNote}`,
      entities: rarely.map((b) => ({
        id: b.name,
        name: b.name,
        facts: `About ${formatQuantity(b.avgGib)} GiB stored (${formatQuantity(b.gibDays)} GiB-days), ${b.queries.toLocaleString(appLocale())} queries. ${b.type}.`,
      })),
      why:
        `Retention is billed per GiB-day stored, whether or not anyone reads the data.` +
        (rarelyCost > 0 ? ` Estimated retention for these buckets: about ${money(rates, rarelyCost)} for this timeframe, at the rates in use (named above).` : "") +
        " Retention length is not shown: reading it needs a permission this app does not request.",
      steps: [
        "Check with the data owner how far back anyone needs this data.",
        "Open Settings > Storage management > Bucket storage management and edit the bucket.",
        "Lower the retention period to match, or route new data to a bucket with shorter retention.",
      ],
      more: buckets.length ? <BucketTable buckets={buckets} /> : undefined,
      priced: rarelyCost > 0,
      link: { label: "Optimize log retention", url: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs/lma-use-cases/optimize-log-retention" },
      tradeOff: "Shortening retention deletes data older than the new period. Not reversible.",
      who: "The data owner, with whoever is accountable for audit or compliance retention.",
      when: "After confirming retention obligations.",
      upTo: null,
    },
    {
      key: "rwiq",
      title: "Log buckets where the other retention model is estimated to cost less",
      status: modelChecks.length === 0 ? "clear" : switchWorth.length ? "review" : "noSaving",
      found:
        modelChecks.length === 0
          ? rRetain === null || rRwiq === null || rQuery === null
            ? "Not checked: needs a price for log Retain, Retain with Included Queries and Query."
            : "No log buckets were retained in this timeframe."
          : switchWorth.length
            ? `${switchWorth.length} of ${plural(modelChecks.length, "log bucket", "log buckets")} are estimated to cost less on the other retention model; query cost is an upper bound.${tinyLogNote}`
            : `${modelChecks.length === 1 ? "The log bucket is" : modelChecks.length === 2 ? "Both log buckets are" : `All ${modelChecks.length} log buckets are`} already on the model estimated to cost less for how ${modelChecks.length === 1 ? "it is" : "they are"} queried.${tinyLogNote}`,
      entities: switchWorth.map((b) => ({
        id: b.name,
        name: b.name,
        facts: b.onRwiq
          ? `Estimated at the rates in use. Retain with Included Queries: ${money(rates, b.included)}, not counting queries beyond the included window. Usage-based: at most ${money(rates, b.usageBased)}.`
          : `Estimated at the rates in use. Usage-based: at most ${money(rates, b.usageBased)} (${formatQuantity(b.onDemand / GIB)} GiB scanned). Retain with Included Queries: ${money(rates, b.included)}, not counting queries beyond the included window.`,
      })),
      why:
        "Retain with Included Queries costs more per GiB-day stored but covers queries on the included days; usage-based charges every GiB scanned. Which is cheaper depends on how heavily a bucket is queried. Query cost here is an upper bound from query executions: scan-skipped data is billed at a 98% discount." +
        (billedLogQueryGib !== null && logBuckets.length
          ? ` For comparison, Dynatrace billed ${formatQuantity(billedLogQueryGib)} GiB of log queries across all buckets in this timeframe, against ${formatQuantity(scannedLogGib)} GiB scanned on the buckets listed.`
          : ""),
      steps: [
        "Open Settings > Storage management > Bucket storage management and edit the log bucket.",
        "Set or clear the included query retention period (10 to 35 days).",
        "Watch the Log query usage and costs dashboard for a week.",
      ],
      link: { label: "Retain with Included Queries", url: "https://docs.dynatrace.com/docs/analyze-explore-automate/logs/lma-use-cases/lma-e2e-included-log-queries" },
      tradeOff: "Changeable once per 24 hours, effective at midnight UTC. Included queries have a daily quota of 15 times the retained volume.",
      who: "The log platform owner.",
      when: "Any day; plan around the once-per-24-hours limit.",
      upTo: switchWorth.reduce((a, b) => a + Math.abs(b.usageBased - b.included), 0) || null,
      // The usage-based figure is an upper bound (query cost at most), so the difference can be smaller.
      from: 0,
      priced: switchWorth.length > 0,
    },
    {
      key: "security",
      title: "Runtime Vulnerability Analytics or Application Protection stacked on hosts",
      status: stacked.length ? "review" : "clear",
      found: stacked.length
        ? `${plural(stacked.length, "host carries", "hosts carry")} security add-ons on top of host monitoring.`
        : `No host was billed for ${RVA} or ${RAP} in ${period.phrase}.`,
      entities: stacked.map((h) => ({
        id: h.id,
        name: h.name,
        facts: [h.rva > 0 ? `${formatQuantity(h.rva)} GiB-hours of ${RVA}` : null, h.rap > 0 ? `${formatQuantity(h.rap)} GiB-hours of ${RAP}` : null]
          .filter(Boolean)
          .join(", "),
      })),
      why: "Both add-ons are billed per GiB-hour of host memory, on top of Full-Stack.",
      steps: ["Agree which hosts need runtime security coverage.", "Add monitoring rules that exclude the others (Application Security > monitoring rules).", "Check host coverage after up to 70 minutes."],
      link: { label: "Application Security host coverage", url: "https://docs.dynatrace.com/docs/secure/application-security/getting-started/host-coverage" },
      tradeOff: "Excluded hosts lose vulnerability detection or attack protection.",
      who: "The security team.",
      when: "After a coverage review.",
      upTo: null,
    },
    {
      key: "replay",
      title: "Session Replay share of Real User Monitoring",
      status: replayApps.length ? "review" : "clear",
      found: replayApps.length
        ? `${plural(replayApps.length, "application records", "applications record")} Session Replay.`
        : `No application recorded Session Replay in ${period.phrase}.`,
      entities: replayApps.map((a) => ({
        id: a.id,
        name: a.name,
        facts: `${formatQuantity(a.replays)} replay sessions of ${formatQuantity(a.sessions)} sessions (${a.sessions > 0 ? Math.round((a.replays / a.sessions) * 100) : 0}%).${a.sessions < 1000 ? " Small sample: under 1,000 sessions." : ""}`,
      })),
      why: "Replay sessions are billed as their own capability. The share recorded is the RUM cost and traffic control percentage times the Session Replay percentage.",
      steps: ["Open the application's settings > Enablement and cost control.", "Lower the Session Replay percentage (or the RUM percentage).", "Save."],
      link: { label: "Session Replay cost and traffic control", url: "https://docs.dynatrace.com/docs/observe/digital-experience/session-replay-latest/configure-session-replay-web/latest-enable-session-replay-web" },
      tradeOff: "Fewer sessions to replay when investigating a user problem.",
      who: "The application's digital experience owner.",
      when: "Any time; applies to new sessions.",
      upTo: null,
    },
    {
      key: "untagged",
      title: "Hosts and namespaces without a cost centre",
      status: untaggedHosts.length || untaggedNs.length ? "review" : "clear",
      found:
        `${untaggedHosts.length} of ${plural(tagRows.length, "host", "hosts")} and ${plural(untaggedNs.length, "namespace", "namespaces")} that billed pod-hours have no cost centre on their billing records. The hosts are listed under Entities > Hosts with the Cost centre filter.` +
        (tagNotReaching.length
          ? ` ${tagNotReaching.length === 1 ? "One host has" : `${tagNotReaching.length} hosts have`} a dt.cost.costcenter tag on the host that does not reach billing: check the allowlist and restart the agent.`
          : ""),
      entities: [
        ...tagNotReaching.map((h) => ({ id: h.id, name: h.name, facts: "Host tag dt.cost.costcenter set, not on billing records." })),
        ...untaggedNs.map((n) => ({ id: n.id, name: n.name, facts: `Namespace, ${formatQuantity(n.podHours)} pod-hours.` })),
      ],
      why: "Without a cost centre, usage can't be charged to a team.",
      steps: [
        "Agree the cost centre values and add them to the Cost Allocation allowlist.",
        "Hosts: oneagentctl --set-host-tag=dt.cost.costcenter=<value> --restart-service (OneAgent 1.291+), or set it centrally.",
        "Kubernetes: annotate the namespace metadata.dynatrace.com/dt.cost.costcenter: <value>, then restart pods.",
      ],
      link: { label: "Set up Cost Allocation", url: "https://docs.dynatrace.com/docs/manage-your-costs/allocate/plan-and-set-up" },
      tradeOff: "Not retroactive: usage before the change stays unassigned.",
      who: "Platform owners for hosts and clusters, with finance for the values.",
      when: "Before the next billing period you want to charge back.",
      upTo: null,
    },
  ];

  // Without classic entity tables there is no host-to-service data, and every host would look
  // like it runs no service: say the check can't run here instead.
  if (noClassic) levers[0] = { ...levers[0], unavailable: MSG.noClassicCheck, entities: [], upTo: null };

  // A lever whose query failed is not "checked": leave it out of the headline.
  const leverQueries: Record<string, Q[]> = {
    infra: [hosts],
    idle: [workflows],
    buckets: [retain, scans],
    rwiq: [retain, scans],
    security: [security],
    replay: [replay],
    untagged: [tags, namespaces],
  };
  // A cancelled query is not a check that found nothing.
  const failed = levers.filter((l) => leverQueries[l.key].some((x) => x.error || x.cancelled));
  const unavailable = levers.filter((l) => l.unavailable && !failed.includes(l));
  const checked = levers.filter((l) => !failed.includes(l) && !unavailable.includes(l));
  const review = checked.filter((l) => l.status === "review");
  const priced = review.filter((l) => l.upTo !== null);
  const upTo = priced.reduce((a, l) => a + (l.upTo ?? 0), 0);
  const upFrom = priced.reduce((a, l) => a + (l.from ?? l.upTo ?? 0), 0);
  const loading = [hosts, workflows, retain, scans, replay, namespaces, security, tags, logQueryBilled].some((q) => q.isLoading);
  const queries = [hosts, security, tags, workflows, retain, scans, logQueryBilled, replay, namespaces];
  const last = [hosts, workflows, retain]
    .flatMap((q) => (q.records ?? []).map((r) => (r && typeof r.last_record === "string" ? r.last_record : "")))
    .reduce((a, b) => (b > a ? b : a), "");
  return { levers, checked, failed, unavailable, review, upTo, upFrom, loading, queries, last, sources, rates, period, href, hosts, workflows, retain, scans, security, replay, tags, namespaces };
}

export const Fixes = () => {
  const { levers, checked, failed, unavailable, review, upTo, upFrom, loading, queries, last, sources, rates, period, href, hosts, workflows, retain, scans, security, replay, tags, namespaces } = useFixList();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      {loading ? (
        <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
          <Bone w="70%" h={38} />
          <Bone w="55%" h={24} />
        </div>
      ) : (
        <Answer
          setup={review.length ? `${review.length} of ${checked.length} checks` : `${checked.length} of ${levers.length} checks done:`}
          conclusion={review.length ? "found something worth reviewing." : "nothing worth reviewing."}
          lead={
            `Checked against billing in ${period.phrase}. For review only: this app changes nothing.` +
            (failed.length ? ` ${plural(failed.length, "check", "checks")} couldn't run because ${failed.length === 1 ? "its query" : "their queries"} failed.` : "") +
            (unavailable.length ? ` ${plural(unavailable.length, "check", "checks")} can't run in this environment.` : "") +
            (upTo > 0 ? ` ${estimateSentence(rates, upFrom, upTo, sources)}` : "")
          }
        />
      )}
      <span style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
        {sources.size > 0 && <PriceTag sources={sources} />}
        {last && <DataAsOf last={last} />}
      </span>

      {/* "Worth reviewing" first, then checks that found nothing; the original order breaks ties. */}
      {[
        { lever: levers[0], q: hosts },
        { lever: levers[1], q: workflows },
        { lever: levers[2], q: retain, extra: scans },
        { lever: levers[3], q: retain, extra: scans },
        { lever: levers[4], q: security },
        { lever: levers[5], q: replay },
        { lever: levers[6], q: tags, extra: namespaces },
      ]
        .map((x, i) => ({ ...x, i }))
        .sort((a, b) => Number(b.lever.status === "review") - Number(a.lever.status === "review") || a.i - b.i)
        .map(({ lever, q, extra }) => (
          <LeverSection key={lever.key} lever={lever} q={q} extra={extra} href={href} />
        ))}

      <NextSteps links={[{ to: R.ownership, label: "Give hosts and namespaces an owner" }, { to: R.spend, label: "See the full spend" }]} />
      <ShowQuery query={queries.map((q) => q.query).join("\n\n")} />
    </div>
  );
};

type Q = ReturnType<typeof useBillingQuery>;

/** Stands in for "the queries answered" so QueryOutcome shows the check, never its generic empty state. */
const NON_EMPTY = [{}];

/** Entities listed under a lever before "Show all". */
const ENTITY_PREVIEW = 5;

const STATUS_TEXT: Record<Status, string> = {
  review: "Worth reviewing",
  clear: "Checked, nothing found",
  noSaving: "Checked, no estimated saving",
};

function LeverSection({ lever, q, extra, href }: { lever: Lever; q: Q; extra?: Q; href: (p: string) => string }) {
  // ?open=<key> (from "How to set a cost centre" on the Overview) unfolds that check and brings it into view.
  const [params] = useSearchParams();
  const openKey = params.get("open");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openKey === lever.key && !q.isLoading) // Smooth unless the person asked for reduced motion (a JS scroll ignores the CSS setting).
      ref.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [openKey, lever.key, q.isLoading]);
  // Either query of a check failing or being cancelled shows that query's state; partial results from either are said.
  const bad = (x?: Q) => Boolean(x && (x.error || x.cancelled));
  const failing = extra && bad(extra) && !bad(q) ? extra : q;
  const pager = usePager(lever.entities.length, ENTITY_PREVIEW);
  const review = lever.status === "review";
  return (
    <section ref={ref} id={lever.key} aria-label={lever.title} style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[12], scrollMarginTop: 96 }}>
      {/* Every lever folds to one line with its status; people open the ones they want. A failed query opens so the error is seen. */}
      <details className="lc-details lc-lever" open={bad(failing) || openKey === lever.key} style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[16], flexWrap: "wrap", padding: 0 }}>
        <h2 style={{ margin: 0, ...type.title, flex: "1 1 320px" }}>{lever.title}</h2>
        {!q.isLoading && !bad(failing) &&
          (lever.unavailable ? <Label>{MSG.noClassicStatus}</Label> : review ? <SignalLabel>{STATUS_TEXT.review}</SignalLabel> : <Label>{STATUS_TEXT[lever.status]}</Label>)}
      </summary>
      <div style={{ paddingTop: space[12] }}>
      <QueryOutcome
        query={failing.query}
        // Zero rows is a finding for a check ("nothing found"), not an empty screen: show the check's own text.
        records={failing.error ? failing.records : NON_EMPTY}
        error={failing.error}
        errorKind={failing.errorKind}
        partial={q.partial || Boolean(extra?.partial)}
        isLoading={q.isLoading || Boolean(extra?.isLoading)}
        retry={failing.retry} cancel={failing.cancel} cancelled={failing.cancelled}
        skeleton={<Bone w="100%" h={160} r={radius.surface} />}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
          <Field label="What was found">{lever.unavailable ?? lever.found}</Field>
          {lever.entities.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
              {disambiguate(lever.entities.map((e) => ({ ...e, entityId: e.id !== e.name ? e.id : undefined }))).slice(0, pager.shown).map((e) => (
                <li key={e.id} style={{ display: "flex", flexDirection: "column", gap: space[4], padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
                  {e.id.startsWith("HOST-") ? (
                    <Link to={href(R.host(e.id))} className="lc-link" style={{ ...type.heading, color: color.textPrimary, textDecoration: "none", overflowWrap: "anywhere" }}>
                      {e.name}
                    </Link>
                  ) : (
                    <span style={{ ...type.heading, overflowWrap: "anywhere" }}>{e.name}</span>
                  )}
                  {e.id !== e.name && <EntityIdLine id={e.id} />}
                  <span style={{ ...type.body, color: color.textSecondary }}>{e.facts}</span>
                </li>
              ))}
            </ul>
          )}
          {pager.needed && <PagerFooter pager={pager} noun="items" filterHint={false} />}
          {lever.entities.length > 0 && (
            <CsvDownload filtered={false}
              name={`fix-list-${lever.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
              noun="items"
              rows={lever.entities}
              columns={[
                { header: "Check", value: () => lever.title },
                { header: "Name", value: (e) => e.name },
                { header: "ID", value: (e) => (e.id !== e.name ? e.id : null) },
                { header: "What was found", value: (e) => e.facts },
              ]}
            />
          )}
          {lever.more}
          {lever.status !== "clear" && !lever.unavailable && (
            <details className="lc-details" open={lever.status === "review"} style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
              <summary style={{ ...type.heading, color: color.textPrimary, padding: `${space[4]}px 0` }}>Options, and the trade-off</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: space[16], paddingTop: space[12] }}>
              <Field label="Why it matters">{lever.why}</Field>
              <Field label="Options">
                <ol style={{ margin: 0, paddingLeft: space[24], display: "flex", flexDirection: "column", gap: space[4] }}>
                  {lever.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <a href={lever.link.url} target="_blank" rel="noreferrer" className="lc-link" style={{ color: color.textPrimary }}>
                  {lever.link.label} (Dynatrace documentation)
                </a>
              </Field>
              <Field label="Trade-off">{lever.tradeOff}</Field>
              <div style={{ display: "flex", gap: space[32], flexWrap: "wrap" }}>
                <Field label="Usually involves">{lever.who}</Field>
                <Field label="When">{lever.when}</Field>
              </div>
              </div>
            </details>
          )}
        </div>
      </QueryOutcome>
      </div>
      </details>
    </section>
  );
}

/** Bucket utility: stored volume against query volume, every retained bucket. */
function BucketTable({ buckets }: { buckets: { name: string; type: string; avgGib: number; gibDays: number; queries: number; onDemand: number; included: number }[] }) {
  const rows = [...buckets].sort((a, b) => b.avgGib - a.avgGib);
  const cols = "minmax(200px, 2fr) repeat(3, minmax(110px, 1fr))";
  const cell: React.CSSProperties = { ...type.body, color: color.textSecondary, textAlign: "right" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
      <Label>Every retained bucket: stored against queried</Label>
      <div role="table" aria-label="Bucket utility" style={{ display: "flex", flexDirection: "column", overflowX: "auto" }}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: cols, gap: space[16], padding: `0 ${space[8]}px ${space[8]}px` }}>
          {["Bucket", "Stored (average GiB)", "Queries", "GiB scanned"].map((h, i) => (
            <span key={h} role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: i ? "right" : "left" }}>
              {h}
            </span>
          ))}
        </div>
        {rows.map((b) => (
          <div key={`${b.name}|${b.type}`} role="row" style={{ display: "grid", gridTemplateColumns: cols, gap: space[16], padding: `${space[8]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
            <span role="cell" style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ ...type.body, color: color.textPrimary, overflowWrap: "anywhere" }}>{b.name}</span>
              <span style={{ ...type.body, color: color.textTertiary }}>{b.type}</span>
            </span>
            <span role="cell" style={cell}>{formatQuantity(b.avgGib)}</span>
            <span role="cell" style={cell}>{b.queries.toLocaleString(appLocale())}</span>
            <span role="cell" style={cell}>{formatQuantity((b.onDemand + b.included) / GIB)}</span>
          </div>
        ))}
      </div>
      <span style={{ ...type.body, color: color.textTertiary }}>
        Queries count every query that read the bucket, including dashboards and automations. Buckets with no stored data
        in the timeframe are not listed.
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
      <Label>{label}</Label>
      <div style={{ ...type.body, color: color.textPrimary, display: "flex", flexDirection: "column", gap: space[8] }}>{children}</div>
    </div>
  );
}
