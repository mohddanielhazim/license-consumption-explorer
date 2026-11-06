import { useSyncExternalStore } from "react";

/**
 * Newer environments have no classic entity tables (`fetch dt.entity.host`
 * fails with "isn't a valid data object"); they have Smartscape only. Every
 * classic-table use in this app is a `| lookup [fetch dt.entity.…]` step that
 * adds names and details (host group, tags, zones) to billing rows, so the
 * billing figures do not depend on it.
 *
 * The first query that fails this way moves the app to Smartscape: names come
 * from `smartscapeNodes` instead, and details Smartscape doesn't carry here are
 * left out. If Smartscape can't be read either, the lookups are dropped. Each
 * step is taken once, on the first failure; environments with the classic
 * tables run no extra query.
 */
export type EntityMode = "classic" | "smartscape" | "none";

let mode: EntityMode = "classic";
const listeners = new Set<() => void>();
const setMode = (next: EntityMode) => {
  if (mode === next) return;
  mode = next;
  listeners.forEach((l) => l());
};

export function entityMode(): EntityMode {
  return mode;
}

export function classicEntitiesMissing(): boolean {
  return mode !== "classic";
}

export function useEntityMode(): EntityMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
  );
}

export function useClassicEntitiesMissing(): boolean {
  return useEntityMode() !== "classic";
}

function errorText(error: unknown): string {
  let text: string;
  try {
    text = `${(error as Error).message ?? ""} ${JSON.stringify(error)}`;
  } catch {
    text = String((error as Error).message ?? "");
  }
  return text;
}

/** True when a query failed only because the environment has no classic entity tables. */
export function isMissingClassicError(error: unknown, query: string): boolean {
  if (!error || !/fetch dt\.entity\./.test(query)) return false;
  return /UNKNOWN_DATA_OBJECT|isn't a valid data object/i.test(errorText(error));
}

/** True when a query with Smartscape lookups failed because Smartscape can't be read here. */
export function isSmartscapeError(error: unknown, query: string): boolean {
  if (!error || !query.includes("smartscapeNodes")) return false;
  return /smartscape|UNKNOWN_DATA_OBJECT|not_authorized|forbidden|403|permission/i.test(errorText(error));
}

/** Called with each query's error: moves the app one step down when the entity source is the cause. */
export function noteEntityError(error: unknown, query: string): boolean {
  if (mode === "classic" && isMissingClassicError(error, query)) {
    setMode("smartscape");
    return true;
  }
  if (mode === "smartscape" && isSmartscapeError(error, query)) {
    setMode("none");
    return true;
  }
  return false;
}

/** Each `| lookup [fetch dt.entity.…] …, prefix: "x."` step, over one or more lines. */
const CLASSIC_LOOKUP = /\n\|\s*lookup \[fetch dt\.entity\.([a-z_]+)[\s\S]*?prefix: "[^"]*"/g;

/**
 * Smartscape node types for the classic tables this app reads names from.
 * Checked on a Smartscape-only environment (2026-10-16): FRONTEND carries web
 * applications, with the classic APPLICATION- id in id_classic. Synthetic
 * monitors and services are left out until a record proves their type.
 */
const SMARTSCAPE_TYPE: Record<string, string> = {
  host: "HOST",
  kubernetes_cluster: "K8S_CLUSTER",
  cloud_application_namespace: "K8S_NAMESPACE",
  application: "FRONTEND",
  mobile_application: "FRONTEND",
};

/** The query without its classic-table lookup steps. */
export function withoutClassicLookups(query: string): string {
  return query.replace(CLASSIC_LOOKUP, "");
}

/**
 * The query with each classic-table lookup answered from Smartscape: the name
 * only, matched on either the Smartscape id or the classic id (they differ for
 * applications). Lookups with no known Smartscape type are dropped.
 */
export function withSmartscapeLookups(query: string): string {
  return query.replace(CLASSIC_LOOKUP, (step, table: string) => {
    const nodeType = SMARTSCAPE_TYPE[table];
    const tail = /\]\s*,\s*(sourceField:[\s\S]*)$/.exec(step);
    if (!nodeType || !tail) return "";
    return `\n| lookup [smartscapeNodes ${nodeType} | fieldsAdd k = arrayRemoveNulls(array(toString(id), id_classic)) | expand k | dedup k | fields id = k, entity.name = name], ${tail[1]}`;
  });
}

/** The query as this environment can run it. */
export function forEntityMode(query: string, m: EntityMode): string {
  if (m === "classic") return query;
  return m === "smartscape" ? withSmartscapeLookups(query) : withoutClassicLookups(query);
}
