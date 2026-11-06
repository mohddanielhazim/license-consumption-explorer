import { MSG } from "./strings";

/**
 * Each view is one question: "which <entity> consumes this capability?"
 *
 * Every query follows the same shape:
 *   1. fetch dt.system.events
 *   2. filter to BILLING_USAGE_EVENT and one event.type
 *   3. dedup event.id   <-- billing events are refreshed and updated over time,
 *                           and event.id is stable across refreshes. Without
 *                           this you double count.
 *   4. summarize the billed quantity, grouped by the entity field
 *
 * The billed quantity field differs per capability. Field names below were
 * checked on 2026-10-08 against raw records in the development environment (three untouched
 * records per event.type, last 30 days). Views marked UNVERIFIED target an
 * event.type that environment has not emitted in the last 365 days, so their field
 * names are still from documentation.
 *
 * Entity names are not resolved here. entityAttr() and entityName() read the
 * dt.entity.* tables, which need the storage:entities:read scope; this app
 * declares only storage:system:read and storage:buckets:read, so those calls
 * fail with NOT_AUTHORIZED_FOR_TABLE. Rows show entity ids.
 */

export type View = {
  id: string;
  label: string;
  /** Short line shown above the table. */
  blurb: string;
  /** {BILLING_WINDOW} and {IN_PERIOD} are filled at run time, as on every screen (data/period.ts). */
  query: string;
};

export const VIEWS: View[] = [
  {
    id: "overview",
    label: "Overview",
    blurb:
      "Which billing capabilities this environment emits. Note that count() is the number of billing events, not spend. It tells you what to look at, not what it costs.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
{IN_PERIOD}
| summarize events = count(), by:{event.type}
| sort events desc`,
  },
  {
    id: "hosts-fullstack",
    label: "Hosts (Full-Stack)",
    blurb:
      "Full-Stack Monitoring bills on host memory GiB-hours. Rows are host entities, so two rows can share a display name and still be different hosts.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Full-Stack Monitoring"
| dedup event.id
{IN_PERIOD}
| fieldsAdd host = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host)
| summarize gib_hours = sum(billed_gibibyte_hours), by:{host}
| sort gib_hours desc`,
  },
  {
    id: "hosts-infra",
    label: "Hosts (Infrastructure)",
    blurb:
      "Infrastructure Monitoring bills on host hours rather than memory, so the unit here is not comparable with the Full-Stack tab. " + MSG.unverifiedFields,
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Infrastructure Monitoring"
| dedup event.id
{IN_PERIOD}
| fieldsAdd host = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host)
| summarize host_hours = sum(billed_host_hours), by:{host}
| sort host_hours desc`,
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    blurb:
      "Kubernetes Platform Monitoring bills pod-hours and names the cluster and namespace, so it can be split by namespace without cost centres.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Kubernetes Platform Monitoring"
| dedup event.id
{IN_PERIOD}
| summarize pod_hours = sum(billed_pod_hours),
            by:{cluster = coalesce(dt.entity.kubernetes_cluster, toString(dt.smartscape.k8s_cluster)),
                namespace = coalesce(dt.entity.cloud_application_namespace, toString(dt.smartscape.k8s_namespace))}
| sort pod_hours desc`,
  },
  {
    id: "code-monitoring",
    label: "Code Monitoring",
    blurb:
      "Code Monitoring bills container-hours. Records carry the host and, for Kubernetes workloads, the namespace name.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Code Monitoring"
| dedup event.id
{IN_PERIOD}
| summarize container_hours = sum(billed_container_hours),
            by:{host = coalesce(toString(dt.smartscape.host), dt.entity.host), k8s.namespace.name}
| sort container_hours desc`,
  },
  {
    id: "rum",
    label: "Applications (RUM)",
    blurb:
      "Real User Monitoring bills per session and is the only capability that attributes to an application. device.type says web or mobile.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Real User Monitoring"
| dedup event.id
{IN_PERIOD}
| summarize sessions = sum(billed_sessions),
            by:{device.type, application = coalesce(dt.entity.application, dt.entity.device_application, toString(dt.smartscape.frontend))}
| sort sessions desc`,
  },
  {
    id: "security",
    label: "Security per host",
    blurb:
      "Runtime Vulnerability Analytics and Runtime Application Protection both bill per host, so they stack on top of the Full-Stack cost for the same machine. " + MSG.unverifiedFields,
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
  and (event.type == "Runtime Vulnerability Analytics"
       or event.type == "Runtime Application Protection")
| dedup event.id
{IN_PERIOD}
| fieldsAdd host = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host)
| summarize gib_hours = sum(billed_gibibyte_hours), by:{event.type, host}
| sort gib_hours desc`,
  },
  {
    id: "synthetic",
    label: "Synthetic monitors",
    blurb:
      "Browser monitors and clickpaths bill per synthetic action, attributed to the individual monitor. " + MSG.unverifiedFields,
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and in(event.type, {"Browser Monitor or Clickpath", "Browser Monitor and Clickpath"})
| dedup event.id
{IN_PERIOD}
| summarize actions = sum(billed_synthetic_action_count), by:{monitor = coalesce(toString(dt.smartscape.browser_monitor), dt.entity.synthetic_test)}
| sort actions desc`,
  },
  {
    id: "workflows",
    label: "Workflows",
    blurb:
      "Automation Workflow records have no billed quantity field. Each record is one hour of one workflow (event.start to event.end), so the count is workflow-hours, not executions. workflow.owner is a user id, not an email. It is allocated at environment level and left out of the Cost Allocation export.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Automation Workflow"
| dedup event.id
{IN_PERIOD}
| summarize workflow_hours = count(), by:{workflow.id, workflow.title, workflow.owner}
| sort workflow_hours desc`,
  },
  {
    id: "functions",
    label: "App functions",
    blurb:
      "AppEngine function invocations, attributed to the app and function that ran them. Ad hoc invocations carry no dt.app.id or function.id. People are not shown (the Queries screen, By source).",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "AppEngine Functions - Small"
| dedup event.id
{IN_PERIOD}
| summarize invocations = sum(billed_invocations), by:{dt.app.id, function.id}
| sort invocations desc`,
  },
  {
    id: "ingest",
    label: "Ingest and retain",
    blurb:
      "Logs, traces and events bill on bytes; metrics bill on data points. There is no host or service on these records, only usage.bucket, so this is a capability summary, not an entity one. Traces Ingest reports ingested_bytes rather than billed_bytes. Retain records are hourly snapshots of stored size, so the sum is divided by 24 to give GiB-days stored, the unit the Rate card prices. For bucket sizing and query patterns, use the Dynatrace Query Cost Review dashboard.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
  and (contains(event.type, "Ingest") or contains(event.type, "Retain"))
| dedup event.id
{IN_PERIOD}
| fieldsAdd unit = if(isNotNull(data_points), "data points",
                     else: if(contains(event.type, "Retain"), "GiB-days stored",
                     else: "GiB ingested")),
           qty = if(isNotNull(data_points), toDouble(data_points),
                    else: if(contains(event.type, "Retain"), toDouble(billed_bytes) / 1073741824 / 24,
                    else: toDouble(coalesce(billed_bytes, ingested_bytes)) / 1073741824))
| summarize quantity = sum(qty), by:{event.type, usage.bucket, unit}
| sort unit asc, quantity desc`,
  },
  {
    id: "query-human-vs-service",
    label: "Human vs automation",
    blurb:
      "Splits query scanning between people and service accounts. A service account email contains service.sso.dynatrace. Service accounts can scan more than people; this view shows the split.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
  and endsWith(event.type, " - Query")
| filter isNotNull(user.email)
| dedup event.id
{IN_PERIOD}
| fieldsAdd account_type = if(contains(user.email, "service.sso.dynatrace"),
                              "Service account", else: "Human user")
| summarize gib_scanned = sum(billed_bytes) / 1073741824,
            queries = count(),
            by:{account_type, event.type}
| sort gib_scanned desc`,
  },
  {
    id: "query-source",
    label: "Query by source",
    blurb:
      "Which app, dashboard or notebook the scanning came from. Most Events - Query records name an internal Dynatrace service in client.internal_service_context instead of client.application_context, so both are shown.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and endsWith(event.type, " - Query")
| dedup event.id
{IN_PERIOD}
| fieldsAdd source = coalesce(client.application_context, client.internal_service_context)
| summarize gib_scanned = sum(billed_bytes) / 1073741824,
            queries = count(),
            by:{event.type, source}
| sort gib_scanned desc`,
  },
  {
    id: "raw",
    label: "Raw records",
    blurb:
      "Three untouched billing records so you can read the real field names for any capability. Change the event.type in the query to inspect a different one. This is the tab to use when another view comes back empty.",
    query: `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "Kubernetes Platform Monitoring"
| fieldsRemove user.email
| limit 3`,
  },
];

