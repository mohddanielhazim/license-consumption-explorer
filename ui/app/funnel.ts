import { DOCUMENTED_QUANTITY_FIELDS, dqlField, fieldAlias, isQuantityField, type Capability, type QuantityKey } from "./capabilities";
import type { RateSource, Rates } from "./rates";
import { appLocale } from "./locale";

/**
 * One query feeds the whole funnel. Every billing record is classified by
 * three flags, then each capability's quantity is summed per flag combination.
 *
 *   has_entity       names a host, Kubernetes cluster/namespace/node or
 *                    RUM application. The dt.entity.* fields are deprecated
 *                    in favour of dt.smartscape.*, so either counts (checked
 *                    2026-10-08: no record in the development environment had only the new ones)
 *   has_user         names a user (user.email) or a workflow owner
 *   has_cost_centre  dt.cost.costcenter holds a real value, i.e. not absent,
 *                    "unassigned" or "not-allowlisted" (string or list form).
 *                    A real cost centre also makes a record traceable on its
 *                    own: Ingest and Retain records name no host or user, but
 *                    Dynatrace allocates them by cost centre (v0.12.32; before,
 *                    they stopped at Used even when allocated).
 *
 * sum() returns 0 rather than null when no record has the field, so each
 * quantity carries an n_ count to tell "measured zero" from "field absent".
 */
/**
 * Sums for every quantity field: the documented ones plus any the tenant's
 * records carry (from discovery), each with an n_ count. sum() returns 0
 * rather than null when no record has the field, so the n_ count is what
 * tells "measured zero" from "field absent". Every screen that measures usage
 * uses this, so all of them measure it the same way. Aggregations are grouped
 * in braces, as current DQL expects.
 */
export function quantitySums(discovered: string[] = [], extra: string[] = []): string {
  const fields = [...new Set([...DOCUMENTED_QUANTITY_FIELDS, ...discovered.filter(isQuantityField)])];
  return `{records = count(),\n    ${[
    ...fields.map((f) => `${fieldAlias(f)} = sum(${dqlField(f)}), n_${fieldAlias(f)} = countIf(isNotNull(${dqlField(f)}))`),
    ...extra,
  ].join(",\n    ")}}`;
}

/** True when the record names an entity (old dt.entity.* or new dt.smartscape.* fields). */
export const HAS_ENTITY = `isNotNull(dt.entity.host)
    or isNotNull(dt.entity.kubernetes_cluster)
    or isNotNull(dt.entity.cloud_application_namespace)
    or isNotNull(dt.entity.kubernetes_node)
    or isNotNull(dt.entity.application)
    or isNotNull(dt.entity.device_application)
    or isNotNull(dt.entity.synthetic_test)
    or isNotNull(dt.entity.http_check)
    or isNotNull(dt.smartscape.browser_monitor)
    or isNotNull(dt.smartscape.http_monitor)
    or isNotNull(dt.smartscape.host)
    or isNotNull(dt.smartscape.k8s_cluster)
    or isNotNull(dt.smartscape.k8s_namespace)
    or isNotNull(dt.smartscape.frontend)
    or isNotNull(dt.smartscape_source.id)`;

/**
 * The record's real cost centre, or null. Dynatrace writes dt.cost.costcenter
 * as text on host records and as a list of {key, quantity} on Retain and
 * Metrics records (verified in the development environment, 2026-10-09). Both forms are read;
 * the placeholders "unassigned" and "not-allowlisted" and an empty value
 * count as none. Every screen uses this one definition.
 * The list form is read first, outside any if(): inside an if() the
 * list-reading expression nulls the whole result for text values, which hid
 * every text cost centre until the hypothetical tests caught it (v0.12.0).
 * Covered by tests/dql.test.mjs.
 */
export const COST_CENTRE_FIELDS = `| fieldsAdd cc_list = dt.cost.costcenter[][key]
| fieldsAdd cc_keys = coalesce(cc_list, if(type(dt.cost.costcenter) == "string", array(dt.cost.costcenter)))
| fieldsAdd cost_centre = arrayFirst(arrayRemoveNulls(iCollectArray(if(not in(cc_keys[], {"unassigned", "not-allowlisted", ""}), cc_keys[]))))
| fieldsRemove cc_list, cc_keys`;

/**
 * One number per billing record: the quantity of the capability the record
 * bills, chosen by its type (a Traces ingest record carries both
 * ingested_bytes and ingested_spans, so "the first non-null field" is wrong).
 * Records-based capabilities count 1 per record. Used by queries that must
 * stay one compact row per entity at any scale (v0.12.3); unknown types
 * yield null and are left out. Covered by tests/dql.test.mjs.
 */
export function quantityExpression(types: string[], resolve: (eventType: string) => Capability): string {
  const arms = [...new Set(types)].sort().map((t) => {
    const cap = resolve(t);
    const value = cap.quantity === "records" ? "1.0" : `toDouble(${dqlField(cap.quantity)})`;
    return `if(event.type == ${JSON.stringify(t)}, ${value})`;
  });
  return arms.length ? `coalesce(${arms.join(",\n      ")})` : "toDouble(null)";
}

/** Summed quantity from a compact query (`qty`, `n_qty` columns), or null when no record carried one. */
export function compactQuantity(r: Record<string, unknown>): number | null {
  return num(r.n_qty) > 0 ? num(r.qty) : null;
}

/** True when the record names a person: a user email or a workflow owner. */
export const HAS_USER = `coalesce(user.email, "") != "" or coalesce(workflow.owner, "") != ""`;

export const funnelQuery = (fields: string[]) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| fieldsAdd has_entity = ${HAS_ENTITY},
  has_user = ${HAS_USER},
  has_cost_centre = isNotNull(cost_centre)
| summarize ${quantitySums(fields)},
    by:{event.type, has_entity, has_user, has_cost_centre}`;

/**
 * Discovery: one sample record per billing type, keeping only quantity
 * fields, so the app learns which types this tenant bills and what each is
 * measured in. A field present on only some of a type's records could be
 * missed by the sample; the documented fields are always summed regardless.
 */
export const DISCOVERY_QUERY = `fetch dt.system.events, from: {TIMEFRAME}
| filter event.kind == "BILLING_USAGE_EVENT"
| fieldsKeep event.type, "billed_*", "ingested_*", data_points, \`database-instance-hours\`, \`usage.quantity.billable\`
| dedup event.type`;

export type FunnelRow = {
  eventType: string;
  /** Resolved from CAPABILITIES or from discovery; never missing. */
  cap: Capability;
  hasEntity: boolean;
  hasUser: boolean;
  hasCostCentre: boolean;
  records: number;
  /** Sum of the capability's quantity column; null when no record had it. */
  quantity: number | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The capability's quantity from one summarised record, or null if absent. */
export function quantityOf(r: Record<string, unknown>, cap: Capability): number | null {
  const key: QuantityKey = cap.quantity;
  if (key === "records") return num(r.records);
  const alias = fieldAlias(key);
  return num(r[`n_${alias}`]) > 0 ? num(r[alias]) : null;
}

export function parseFunnelRows(
  records: ReadonlyArray<Record<string, unknown> | null>,
  resolve: (eventType: string) => Capability,
): FunnelRow[] {
  return records.flatMap((r) => {
    if (!r) return [];
    const eventType = String(r["event.type"]);
    const cap = resolve(eventType);
    const quantity = quantityOf(r, cap);
    return [
      {
        eventType,
        cap,
        hasEntity: r.has_entity === true,
        hasUser: r.has_user === true,
        hasCostCentre: r.has_cost_centre === true,
        records: num(r.records),
        quantity,
      },
    ];
  });
}

/** Everything known about one capability in the timeframe. */
export type CapabilitySummary = {
  eventType: string;
  cap: Capability;
  records: number;
  /** Native sum, null when the capability cannot be measured. */
  quantity: number | null;
  /** Why this capability is left out of the cost total, if it is. */
  unpriceable?: string;
  /** Furthest funnel stage any of its records reach (1-4). */
  reached: number;
};

export type StageId = 1 | 2 | 3 | 4;

/**
 * The four steps. Names and "check" lines are the approved design copy
 * (design/HANDOFF.md). They replace Billed / Attributable / Has an owner /
 * Charged back.
 */
export const STAGES: { id: StageId; title: string; check: string }[] = [
  { id: 1, title: "Used", check: "Billed in this timeframe" },
  { id: 2, title: "Traceable", check: "Linked to a host, app, person or cost centre" },
  { id: 3, title: "Owned", check: "Cost centre, or run by a person" },
  { id: 4, title: "Charged to a team", check: "In the Cost Allocation export" },
];

/** Which stage a group of records reaches, under strict nesting. */
export function stageReached(row: FunnelRow, cap: Capability | undefined): StageId {
  if (!(row.hasEntity || row.hasUser || row.hasCostCentre)) return 1;
  if (!(row.hasUser || row.hasCostCentre)) return 2;
  if (!(row.hasCostCentre && cap?.chargeback === "yes")) return 3;
  return 4;
}

/** Why a group of records left the funnel after the stage it reached. */
export function dropReason(row: FunnelRow, cap: Capability | undefined): string {
  const reached = stageReached(row, cap);
  if (reached === 1) {
    return "The billing record carries only a storage bucket: no entity, no user and no cost centre.";
  }
  if (reached === 2) {
    return "Names a host, namespace or application, but no real cost centre: dt.cost.costcenter is absent, \"unassigned\" or \"not-allowlisted\".";
  }
  if (reached === 3) {
    if (cap?.chargeback === "no") {
      return "The Cost Allocation export leaves this capability out.";
    }
    if (cap?.chargeback === "query") {
      return "Not carried natively. It can be split by cost centre with a query.";
    }
    if (cap?.chargeback === "unconfirmed") {
      return "Not confirmed that the Cost Allocation export includes this capability.";
    }
    return "Names a user but carries no cost centre. The export allocates by cost centre, not by user.";
  }
  return "";
}

export function summarise(rows: FunnelRow[]): CapabilitySummary[] {
  const byType = new Map<string, CapabilitySummary>();
  for (const row of rows) {
    const cap = row.cap;
    const s =
      byType.get(row.eventType) ??
      ({ eventType: row.eventType, cap, records: 0, quantity: null, reached: 1 });
    s.records += row.records;
    if (row.quantity !== null) s.quantity = (s.quantity ?? 0) + row.quantity;
    s.reached = Math.max(s.reached, stageReached(row, cap));
    byType.set(row.eventType, s);
  }
  for (const s of byType.values()) {
    // Counted in the steps either way; only left out of the cost total.
    if (s.cap.discovered && s.cap.quantity === "records") {
      s.unpriceable = `Its billing records carry no quantity field, so it is counted by its ${s.records.toLocaleString(appLocale())} billing records and cannot be priced.`;
    } else if (s.quantity === null) {
      s.unpriceable = `None of its ${s.records.toLocaleString(appLocale())} billing records carry a quantity field, so there is nothing to price.`;
    }
  }
  return [...byType.values()].sort((a, b) => a.eventType.localeCompare(b.eventType));
}

/** Capabilities billed in the period that no rate source can price (named, left out of cost totals). */
export function unpriced(summaries: CapabilitySummary[], rates: Rates): CapabilitySummary[] {
  return summaries.filter((s) => !s.unpriceable && rates.rateFor(s.eventType) === null);
}

export function rowCost(row: FunnelRow, rates: Rates): { cost: number; source: RateSource } | null {
  const rate = rates.rateFor(row.eventType);
  if (row.quantity === null || rate === null) return null;
  return { cost: row.cap.toRateUnits(row.quantity) * rate.value, source: rate.source };
}

export type DropLine = {
  eventType: string;
  cap: Capability | undefined;
  reason: string;
  cost: number;
  quantity: number;
};

export type FunnelResult = {
  stages: { id: StageId; cost: number }[];
  /** Rate sources behind the totals, for the figure label. */
  sources: Set<RateSource>;
  /** drops[i] lists what fell out between stage i+1 and stage i+2. */
  drops: DropLine[][];
};

/** Strict nesting: a record counts at a stage only if it passed every earlier one. */
export function computeFunnel(rows: FunnelRow[], rates: Rates): FunnelResult {
  const stageCost = [0, 0, 0, 0];
  const drops = new Map<string, DropLine>();
  const sources = new Set<RateSource>();
  for (const row of rows) {
    const priced = rowCost(row, rates);
    if (priced === null) continue;
    const cost = priced.cost;
    sources.add(priced.source);
    const cap = row.cap;
    const reached = stageReached(row, cap);
    for (let s = 0; s < reached; s++) stageCost[s] += cost;
    if (reached < 4) {
      const reason = dropReason(row, cap);
      const key = `${reached}|${row.eventType}|${reason}`;
      const line = drops.get(key) ?? { eventType: row.eventType, cap, reason, cost: 0, quantity: 0 };
      line.cost += cost;
      line.quantity += row.quantity ?? 0;
      drops.set(key, line);
    }
  }
  const dropLists: DropLine[][] = [[], [], []];
  for (const [key, line] of drops) {
    const reached = Number(key.split("|")[0]);
    dropLists[reached - 1].push(line);
  }
  dropLists.forEach((l) => l.sort((a, b) => b.cost - a.cost));
  return {
    stages: STAGES.map((s, i) => ({ id: s.id, cost: stageCost[i] })),
    sources,
    drops: dropLists,
  };
}
