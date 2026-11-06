import { useSyncExternalStore } from "react";

/**
 * App self-cost: every query this app runs, per page, so
 * Diagnostics can say "This page ran N queries". In memory for this browser
 * session only; nothing is stored or sent.
 */
export type QueryRun = { path: string; at: number; scannedBytes: number; records: number; query: string };

let runs: QueryRun[] = [];
const listeners = new Set<() => void>();

export function logQuery(run: QueryRun) {
  runs = [...runs.slice(-499), run];
  listeners.forEach((l) => l());
}

export function useQueryLog(): QueryRun[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => runs,
  );
}
