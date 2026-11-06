import { usePref, type PrefSpec } from "./prefs";
import { NAME } from "../strings";

/**
 * Ownership: who owns an entity, from
 *   1. a real Dynatrace cost centre on its billing records (dt.cost.costcenter),
 *      labelled "Cost Allocation"; or
 *   2. the user's own app-side rules over the customer's tags, host groups,
 *      management zones, Kubernetes labels or annotations, labelled
 *      "App rule (not Dynatrace Cost Allocation)".
 * Rules are per user (user app state); shared rules would need app-state
 * scopes, which the scope rule says to add only on request.
 */
export type RuleSource =
  | "hostTag"
  | "hostGroup"
  | "managementZone"
  | "namespaceLabel"
  | "namespaceAnnotation"
  | "namespaceName";

export type OwnerRule = { id: string; source: RuleSource; key?: string };

export const RULE_LABEL: Record<RuleSource, string> = {
  hostTag: "Host tag",
  hostGroup: "Host group",
  managementZone: "Management zone",
  namespaceLabel: "Namespace label",
  namespaceAnnotation: "Namespace annotation",
  namespaceName: "Namespace name",
};

/** Which rule sources need a key (the tag, label or annotation name). */
export const RULE_NEEDS_KEY: Record<RuleSource, boolean> = {
  hostTag: true,
  hostGroup: false,
  managementZone: false,
  namespaceLabel: true,
  namespaceAnnotation: true,
  namespaceName: false,
};

const SOURCES = Object.keys(RULE_LABEL) as RuleSource[];

const RULES: PrefSpec<OwnerRule[]> = {
  key: "ownership-rules",
  version: 1,
  defaults: [],
  validate: (v) =>
    Array.isArray(v) &&
    v.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as OwnerRule).id === "string" &&
        SOURCES.includes((r as OwnerRule).source),
    )
      ? (v as OwnerRule[])
      : null,
};

export function useOwnerRules() {
  return usePref(RULES);
}

export type Owner = { name: string; via: string; kind: "costAllocation" | "rule" };

const PLACEHOLDER_CC = new Set(["unassigned", "not-allowlisted"]);

/** A real cost centre from billing records, if any. */
export function costCentreOwner(costCentres: unknown): Owner | null {
  const list: unknown[] = Array.isArray(costCentres) ? (costCentres as unknown[]) : [costCentres];
  const real = list.find((c): c is string => typeof c === "string" && c !== "" && !PLACEHOLDER_CC.has(c));
  return real ? { name: real, via: "Cost Allocation cost centre", kind: "costAllocation" } : null;
}

/** Index of the first ":" that is not escaped as "\:" (Dynatrace escapes colons inside keys), or -1. */
export function keySplit(tag: string): number {
  for (let i = 0; i < tag.length; i++) if (tag[i] === ":" && tag[i - 1] !== "\\") return i;
  return -1;
}

/** Tags come as "key:value", "[context]key:value" or bare "key". */
function tagValue(tags: unknown, key: string): string | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const plain = t.replace(/^\[[^\]]*\]/, "");
    const i = keySplit(plain);
    if (i > 0 && plain.slice(0, i).trim().toLowerCase() === key.toLowerCase()) return plain.slice(i + 1).trim() || null;
  }
  return null;
}

function recordValue(rec: unknown, key: string): string | null {
  if (typeof rec !== "object" || rec === null) return null;
  const hit = Object.entries(rec as Record<string, unknown>).find(([k]) => k.toLowerCase() === key.toLowerCase());
  return hit && typeof hit[1] === "string" && hit[1] ? hit[1] : null;
}

function firstZone(zones: unknown): string | null {
  if (!Array.isArray(zones)) return null;
  const z: unknown = (zones as unknown[]).find((x) => typeof x === "string" && x);
  return typeof z === "string" ? z : null;
}

export type HostFacts = { tags?: unknown; hostGroup?: string | null; managementZones?: unknown };
export type NamespaceFacts = {
  name?: string | null;
  labels?: unknown;
  annotations?: unknown;
  managementZones?: unknown;
};

/** The first rule that yields a value wins. */
export function hostOwner(facts: HostFacts, rules: OwnerRule[]): Owner | null {
  for (const r of rules) {
    let v: string | null = null;
    if (r.source === "hostTag" && r.key) v = tagValue(facts.tags, r.key);
    if (r.source === "hostGroup") v = facts.hostGroup ?? null;
    if (r.source === "managementZone") v = firstZone(facts.managementZones);
    if (v) return { name: v, via: `${RULE_LABEL[r.source]}${r.key ? ` "${r.key}"` : ""}`, kind: "rule" };
  }
  return null;
}

export function namespaceOwner(facts: NamespaceFacts, rules: OwnerRule[]): Owner | null {
  for (const r of rules) {
    let v: string | null = null;
    if (r.source === "namespaceLabel" && r.key) v = recordValue(facts.labels, r.key);
    if (r.source === "namespaceAnnotation" && r.key) v = recordValue(facts.annotations, r.key);
    if (r.source === "namespaceName") v = facts.name ?? null;
    if (r.source === "managementZone") v = firstZone(facts.managementZones);
    if (v) return { name: v, via: `${RULE_LABEL[r.source]}${r.key ? ` "${r.key}"` : ""}`, kind: "rule" };
  }
  return null;
}

export const ownerText = (o: Owner | null) =>
  o
    ? `Owner: ${o.name} (${o.kind === "costAllocation" ? o.via : `${o.via}; app rule, not Dynatrace Cost Allocation`})`
    : NAME.noOwnerYet;
