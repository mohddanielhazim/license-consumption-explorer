/**
 * One entry per billing capability (event.type on BILLING_USAGE_EVENT).
 *
 * `quantity` names the column the funnel query sums for this capability (see
 * FUNNEL_QUERY in funnel.ts). `toRateUnits` converts that sum into the unit the
 * rate card prices in, so cost = toRateUnits(sum) * rate.
 *
 * Field names were checked against raw records in the development environment on
 * 2026-10-08. Entries with `verified: false` target an event.type that tenant
 * has not emitted in the last 365 days, so their quantity field is still from
 * documentation.
 */

const GIB = 1073741824;

/**
 * A quantity is the raw billing field the capability is summed on (for
 * example "billed_gibibyte_hours"), or "records" for capabilities whose
 * records carry no quantity and are counted instead.
 */
export type QuantityKey = string;

export type Capability = {
  eventType: string;
  /** Column summed by the funnel query. */
  quantity: QuantityKey;
  /** Unit of the native measurement, as shown next to the number. */
  nativeUnit: string;
  /** Converts the native sum into the unit the rate card prices in. */
  toRateUnits: (sum: number) => number;
  /** Shown next to the rate input, e.g. "per GiB-hour". */
  rateUnit: string;
  /**
   * Whether Account Management's Cost Allocation export (chargeback) carries
   * this capability. One flag per capability, so changing a verdict is a
   * one-line edit.
   *
   *   "yes"          the Semantic Dictionary billing event model defines
   *                  dt.cost.costcenter and dt.cost.product for it
   *   "no"           the model defines neither, and the capability is
   *                  documented as environment level / not exported
   *   "unconfirmed"  the model defines neither, but nothing states it is
   *                  excluded; shown as "not confirmed" rather than promised
   *   "query"        not carried natively, but Dynatrace documents a DQL
   *                  query that splits it by cost centre (no team tag fixes it)
   *
   * Source: docs.dynatrace.com/docs/semantic-dictionary/model/dt-system-events
   * (page updated 2026-09-21), read 2026-10-08.
   */
  chargeback: "yes" | "no" | "unconfirmed" | "query";
  /** What the billing record names, for "linked to" copy. */
  linkedTo?: "host" | "namespace" | "application" | "monitor";
  /** Where the detail for this capability lives in the app. */
  detail?: "hosts" | "kubernetes";
  verified: boolean;
  /** True when this entry was built from the tenant's records, not this file. */
  discovered?: boolean;
};

const bytesToGib = (sum: number) => sum / GIB;

export const CAPABILITIES: Capability[] = [
  {
    eventType: "Full-Stack Monitoring",
    quantity: "billed_gibibyte_hours",
    nativeUnit: "GiB-hours",
    toRateUnits: (s) => s,
    rateUnit: "per GiB-hour",
    chargeback: "yes",
    linkedTo: "host",
    detail: "hosts",
    verified: true,
  },
  {
    eventType: "Infrastructure Monitoring",
    quantity: "billed_host_hours",
    nativeUnit: "host-hours",
    toRateUnits: (s) => s,
    rateUnit: "per host-hour",
    chargeback: "yes",
    linkedTo: "host",
    detail: "hosts",
    verified: false,
  },
  {
    eventType: "Kubernetes Platform Monitoring",
    quantity: "billed_pod_hours",
    nativeUnit: "pod-hours",
    toRateUnits: (s) => s,
    rateUnit: "per pod-hour",
    // Not native yet. "Analyze Cost Allocation data" documents a DQL example
    // that derives cost centres from the namespace for this capability:
    // https://docs.dynatrace.com/docs/manage-your-costs/allocate/analyze
    // (section "Analyze Cost Allocation data from hosts monitored with
    // Kubernetes Platform Monitoring"; checked 2026-10-08). It looks up
    // dt.smartscape.k8s_namespace, which needs storage:smartscape:read.
    chargeback: "query",
    linkedTo: "namespace",
    detail: "kubernetes",
    verified: true,
  },
  {
    eventType: "Code Monitoring",
    quantity: "billed_container_hours",
    nativeUnit: "container-hours",
    toRateUnits: (s) => s,
    rateUnit: "per container-hour",
    chargeback: "yes",
    linkedTo: "host",
    detail: "hosts",
    verified: true,
  },
  {
    eventType: "Real User Monitoring",
    quantity: "billed_sessions",
    nativeUnit: "sessions",
    toRateUnits: (s) => s,
    rateUnit: "per session",
    // Cost Allocation does not support it yet. The Cost Allocation roadmap
    // thread lists RUM as prioritised with no delivery date, and Dynatrace
    // staff confirmed it as a current limitation in May 2026 (source given by
    // https://community.dynatrace.com/t5/DPS-Cost-Allocation/Cost-Allocation-Roadmap-Updates-Thread/m-p/279082
    // The Semantic Dictionary model also defines no dt.cost.* field for it.
    chargeback: "no",
    linkedTo: "application",
    verified: true,
  },
  {
    eventType: "Runtime Vulnerability Analytics",
    quantity: "billed_gibibyte_hours",
    nativeUnit: "GiB-hours",
    toRateUnits: (s) => s,
    rateUnit: "per GiB-hour",
    chargeback: "yes",
    linkedTo: "host",
    detail: "hosts",
    verified: false,
  },
  {
    eventType: "Runtime Application Protection",
    quantity: "billed_gibibyte_hours",
    nativeUnit: "GiB-hours",
    toRateUnits: (s) => s,
    rateUnit: "per GiB-hour",
    chargeback: "yes",
    linkedTo: "host",
    detail: "hosts",
    verified: false,
  },
  {
    eventType: "Browser Monitor or Clickpath",
    quantity: "billed_synthetic_action_count",
    nativeUnit: "synthetic actions",
    toRateUnits: (s) => s,
    rateUnit: "per synthetic action",
    chargeback: "no",
    linkedTo: "monitor",
    verified: false,
  },
  {
    // No billed quantity field. Each record is one hour of one workflow
    // (event.end - event.start is 60 minutes on every record).
    eventType: "Automation Workflow",
    quantity: "records",
    nativeUnit: "workflow-hours",
    toRateUnits: (s) => s,
    rateUnit: "per workflow-hour",
    chargeback: "no",
    verified: true,
  },
  {
    eventType: "AppEngine Functions - Small",
    quantity: "billed_invocations",
    nativeUnit: "invocations",
    toRateUnits: (s) => s,
    rateUnit: "per invocation",
    chargeback: "no",
    verified: true,
  },
  {
    eventType: "Log Management & Analytics - Ingest & Process",
    quantity: "billed_bytes",
    nativeUnit: "GiB ingested",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB ingested",
    chargeback: "yes",
    verified: true,
  },
  {
    eventType: "Events - Ingest & Process",
    quantity: "billed_bytes",
    nativeUnit: "GiB ingested",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB ingested",
    chargeback: "unconfirmed",
    verified: true,
  },
  {
    // Traces Ingest reports ingested_bytes, not billed_bytes.
    eventType: "Traces - Ingest & Process",
    quantity: "ingested_bytes",
    nativeUnit: "GiB ingested",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB ingested",
    chargeback: "yes",
    verified: true,
  },
  {
    eventType: "Metrics - Ingest & Process",
    quantity: "data_points",
    nativeUnit: "data points",
    toRateUnits: (s) => s / 100000,
    rateUnit: "per 100,000 data points",
    chargeback: "yes",
    verified: true,
  },
  // Retain records are hourly snapshots of stored size, so the sum of
  // billed_bytes is byte-hours. Divide by 24 for GiB-days.
  {
    eventType: "Log Management & Analytics - Retain",
    quantity: "billed_bytes",
    nativeUnit: "GiB-days stored",
    toRateUnits: (s) => s / GIB / 24,
    rateUnit: "per GiB-day",
    chargeback: "yes",
    verified: true,
  },
  {
    eventType: "Log Management & Analytics - Retain with Included Queries",
    quantity: "billed_bytes",
    nativeUnit: "GiB-days stored",
    toRateUnits: (s) => s / GIB / 24,
    rateUnit: "per GiB-day",
    chargeback: "yes",
    verified: true,
  },
  {
    eventType: "Events - Retain",
    quantity: "billed_bytes",
    nativeUnit: "GiB-days stored",
    toRateUnits: (s) => s / GIB / 24,
    rateUnit: "per GiB-day",
    chargeback: "unconfirmed",
    verified: true,
  },
  {
    eventType: "Log Management & Analytics - Query",
    quantity: "billed_bytes",
    nativeUnit: "GiB scanned",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB scanned",
    chargeback: "no",
    verified: true,
  },
  {
    eventType: "Events - Query",
    quantity: "billed_bytes",
    nativeUnit: "GiB scanned",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB scanned",
    chargeback: "no",
    verified: true,
  },
  {
    eventType: "Traces - Query",
    quantity: "billed_bytes",
    nativeUnit: "GiB scanned",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB scanned",
    chargeback: "no",
    verified: true,
  },
  {
    eventType: "Digital Experience Monitoring - Query",
    quantity: "billed_bytes",
    nativeUnit: "GiB scanned",
    toRateUnits: bytesToGib,
    rateUnit: "per GiB scanned",
    chargeback: "no",
    verified: true,
  },
  // Below: documented in the Semantic Dictionary / rate card but not billed on
  // the development environment, so their fields are NOT VERIFIED on a real record.
  {
    eventType: "Foundation & Discovery",
    quantity: "billed_host_hours",
    nativeUnit: "host-hours",
    toRateUnits: (s) => s,
    rateUnit: "per host-hour",
    chargeback: "yes",
    linkedTo: "host",
    detail: "hosts",
    verified: false,
  },
  {
    // No quantity field: each record is counted as one node-hour (records
    // arrive on the hour; NOT VERIFIED that one record = one node-hour).
    eventType: "Security Posture Management",
    quantity: "records",
    nativeUnit: "node-hours",
    toRateUnits: (s) => s,
    rateUnit: "per host-hour",
    chargeback: "unconfirmed",
    verified: false,
  },
  {
    eventType: "Real User Monitoring with Session Replay",
    quantity: "billed_replay_sessions",
    nativeUnit: "session replay captures",
    toRateUnits: (s) => s,
    rateUnit: "per session replay capture",
    chargeback: "no",
    linkedTo: "application",
    verified: false,
  },
  {
    eventType: "HTTP Monitor",
    quantity: "billed_http_request_count",
    nativeUnit: "synthetic requests",
    toRateUnits: (s) => s,
    rateUnit: "per synthetic request",
    chargeback: "no",
    linkedTo: "monitor",
    verified: false,
  },
  {
    eventType: "Database Monitoring",
    quantity: "database-instance-hours",
    nativeUnit: "instance-hours",
    toRateUnits: (s) => s,
    rateUnit: "per database-instance-hour",
    chargeback: "unconfirmed",
    verified: false,
  },
  {
    eventType: "AI Units",
    quantity: "usage.quantity.billable",
    nativeUnit: "AI units",
    toRateUnits: (s) => s,
    rateUnit: "per AI unit",
    chargeback: "no",
    verified: false,
  },
  {
    eventType: "Traces - Retain",
    quantity: "billed_bytes",
    nativeUnit: "GiB-days stored",
    toRateUnits: (s) => s / GIB / 24,
    rateUnit: "per GiB-day",
    chargeback: "unconfirmed",
    verified: false,
  },
  {
    eventType: "Metrics - Retain",
    quantity: "billed_bytes",
    nativeUnit: "GiB-days stored",
    toRateUnits: (s) => s / GIB / 24,
    rateUnit: "per GiB-day",
    chargeback: "unconfirmed",
    verified: false,
  },
];

export const CAPABILITY_BY_TYPE = new Map(
  CAPABILITIES.map((c) => [c.eventType, c]),
);

/**
 * Converts the native sum into the figure shown to the user in `nativeUnit`.
 * Bytes become GiB, Retain byte-hours become GiB-days; hour and count units
 * are shown as summed.
 */
export function nativeDisplay(cap: Capability, sum: number): number {
  if (cap.quantity === "billed_bytes" || cap.quantity === "ingested_bytes") {
    return cap.toRateUnits(sum);
  }
  return sum;
}

/**
 * Account Management writes capability names with different dashes and
 * spacing from event.type (the public rate card uses an en dash in "Log
 * Management & Analytics – Retain with Included Queries"). Compare them
 * with dashes and whitespace normalised, case-insensitively.
 */
export const sameCapability = (a: string, b: string) => normaliseName(a) === normaliseName(b);
const normaliseName = (s: string) => s.toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();

/** Every quantity field the Semantic Dictionary documents for billing events. */
export const DOCUMENTED_QUANTITY_FIELDS = [
  "billed_gibibyte_hours",
  "billed_host_hours",
  "billed_pod_hours",
  "billed_container_hours",
  "billed_sessions",
  "billed_property_sessions",
  "billed_replay_sessions",
  "billed_invocations",
  "billed_synthetic_action_count",
  "billed_http_request_count",
  "billed_test_result_ingestion_count",
  "billed_msu_hours",
  "database-instance-hours",
  "usage.quantity.billable",
  "billed_bytes",
  "ingested_bytes",
  "ingested_spans",
  "data_points",
];

/** Field names come from tenant data and go into queries: accept only plain identifiers. */
export const isQuantityField = (f: string) =>
  /^(billed|ingested)_[a-z0-9_]+$|^data_points$/.test(f) || f === "database-instance-hours" || f === "usage.quantity.billable";

/** DQL needs backticks around field names with dots or hyphens. */
export const dqlField = (f: string) => (/^[a-z0-9_]+$/.test(f) ? f : `\`${f}\``);

/** The column alias a summed field gets (plain identifier). */
export const fieldAlias = (f: string) => f.replace(/[^a-z0-9_]/g, "_");

const ACRONYMS: Record<string, string> = { gibibyte: "GiB", msu: "MSU", http: "HTTP" };

/** "billed_msu_hours" -> "MSU-hours", "billed_http_request_count" -> "HTTP requests". */
export function unitFromField(field: string): string {
  if (field === "billed_bytes" || field === "ingested_bytes") return "GiB";
  if (field === "data_points") return "data points";
  const words = field.replace(/^(billed|ingested)_/, "").split("_").map((w) => ACRONYMS[w] ?? w);
  if (words[words.length - 1] === "hours" && words.length > 1) {
    return `${words.slice(0, -1).join(" ")}-hours`;
  }
  if (words[words.length - 1] === "count") {
    const rest = words.slice(0, -1);
    const last = rest.pop() ?? "item";
    return [...rest, last.endsWith("s") ? last : `${last}s`].join(" ");
  }
  return words.join(" ");
}

/** Prefer a billed_* field, then ingested bytes, then data points, then anything else. */
function primaryField(fields: string[]): string | undefined {
  const usable = fields.filter(isQuantityField);
  return (
    usable.find((f) => f.startsWith("billed_")) ??
    usable.find((f) => f === "ingested_bytes") ??
    usable.find((f) => f === "data_points") ??
    usable[0]
  );
}

/**
 * The capability for a billing type: the verified entry in CAPABILITIES when
 * there is one, otherwise one built from the quantity fields this tenant's
 * records carry. Unknown types are never dropped: a type with no quantity
 * field is counted by billing records.
 */
export function resolveCapability(eventType: string, fields: string[]): Capability {
  const known = CAPABILITY_BY_TYPE.get(eventType);
  if (known) return known;
  const field = primaryField(fields);
  if (!field) {
    return {
      eventType,
      quantity: "records",
      nativeUnit: "billing records",
      toRateUnits: (s) => s,
      rateUnit: "per billing record",
      chargeback: "unconfirmed",
      verified: false,
      discovered: true,
    };
  }
  const unit = unitFromField(field);
  const bytes = field === "billed_bytes" || field === "ingested_bytes";
  return {
    eventType,
    quantity: field,
    nativeUnit: unit,
    toRateUnits: bytes ? (s) => s / GIB : (s) => s,
    rateUnit: `per ${unit.replace(/s$/, "")}`,
    chargeback: "unconfirmed",
    verified: false,
    discovered: true,
  };
}

/**
 * How a capability is named on screen (v0.12.32): Dynatrace's own name, exactly as
 * Account Management, the rate card and invoices write it ("Events - Ingest & Process"),
 * so a reader can match lines one for one. Earlier versions swapped " - " for " · ",
 */
export function capabilityLabel(eventType: string): string {
  return eventType;
}
