import React from "react";
import { useSearchParams } from "react-router-dom";

import { color, space, type } from "../design/tokens";
import { Segmented } from "../design/primitives";

/**
 * "Group by" for host lists (v0.12.11). Admins think in groups (host groups,
 * monitoring modes, cost tags), not in individual hosts: the same filtered
 * hosts, added up per group. Kept in the URL (?group=) so links and Back work.
 */
export function useGroupBy<K extends string>(allowed: readonly K[]): [K | "host", (k: K | "host") => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("group");
  const value = (allowed as readonly string[]).includes(raw ?? "") ? (raw as K) : "host";
  const set = (k: K | "host") => {
    const p = new URLSearchParams(params);
    if (k === "host") p.delete("group");
    else p.set("group", k);
    // A new grouping is a step Back can undo.
    setParams(p);
  };
  return [value, set];
}

export function GroupBySwitch<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: K | "host"; label: string }[];
  value: K | "host";
  onChange: (k: K | "host") => void;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: space[8], flexWrap: "wrap" }}>
      <span style={{ ...type.label, color: color.textTertiary }}>Group by</span>
      <Segmented<K | "host"> label="Group by" value={value} onChange={onChange} options={options} />
    </span>
  );
}

/** Adds up rows per group key: count and the sum of a value. */
export function groupRows<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): { key: string; count: number; total: number }[] {
  const m = new Map<string, { key: string; count: number; total: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, count: 0, total: 0 };
    g.count += 1;
    g.total += value(r);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}
