import { useCallback, useMemo } from "react";

import { resolveCapability, type Capability } from "../capabilities";
import { DISCOVERY_QUERY, quantityExpression } from "../funnel";
import { classifyError, useBillingQuery, type ErrorKind, type QueryRecords, type QueryWindow } from "./shared";

/**
 * Learns which billing types this tenant bills, and which quantity fields
 * each carries, from the tenant's own records (DISCOVERY_QUERY).
 */
export function useDiscovery(window?: QueryWindow) {
  const discovery = useBillingQuery(DISCOVERY_QUERY, { window });
  const fieldsByType = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of discovery.records ?? []) {
      if (!r) continue;
      m.set(
        String(r["event.type"]),
        Object.keys(r).filter((k) => k !== "event.type"),
      );
    }
    return m;
  }, [discovery.records]);
  const fields = useMemo(() => [...new Set([...fieldsByType.values()].flat())].sort(), [fieldsByType]);
  const resolve = useCallback(
    (eventType: string): Capability => resolveCapability(eventType, fieldsByType.get(eventType) ?? []),
    [fieldsByType],
  );
  // Per-type quantity selection for compact per-entity queries.
  const qty = useMemo(() => quantityExpression([...fieldsByType.keys()], resolve), [fieldsByType, resolve]);
  return { discovery, fieldsByType, fields, resolve, qty };
}

/**
 * Runs a measuring query built from the discovered quantity fields, after
 * discovery has finished, and merges the two into one set of states:
 * discovery loading or failed is shown as this query loading or failed;
 * discovery finding no billing records at all is shown as zero records.
 */
export function useMeasuredQuery(build: (fields: string[], qty: string) => string, options: { maxRecords?: number; window?: QueryWindow } = {}) {
  const { discovery, fields, fieldsByType, resolve, qty } = useDiscovery(options.window);
  const ready = discovery.records !== undefined && discovery.records.length > 0;
  const main = useBillingQuery(build(fields, qty), { enabled: ready, maxRecords: options.maxRecords, window: options.window });

  let state: {
    query: string;
    records: QueryRecords | undefined;
    error: Error | undefined | null;
    errorKind: ErrorKind | null;
    partial: boolean;
    isLoading: boolean;
    retry: () => void;
    cancel: () => void;
    cancelled: boolean;
  };
  if (discovery.isLoading) {
    state = { ...main, isLoading: true, error: null, errorKind: null, cancel: discovery.cancel, cancelled: discovery.cancelled };
  } else if (discovery.error || discovery.records === undefined) {
    state = { ...discovery, errorKind: classifyError(discovery.error), partial: false };
  } else if (discovery.records.length === 0) {
    state = { ...discovery, records: [], errorKind: null, partial: false };
  } else {
    state = main;
  }
  return { ...state, resolve, fieldsByType, fields };
}
