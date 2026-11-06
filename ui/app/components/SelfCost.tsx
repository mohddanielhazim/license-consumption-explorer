import React from "react";
import { useLocation } from "react-router-dom";
import { color, space, type } from "../design/tokens";
import { Card } from "../design/primitives";
import { useQueryLog } from "../data/queryLog";
import { appLocale } from "../locale";

/** "This page ran N queries", plus every page visited in this browser session. */
export function SelfCost() {
  const runs = useQueryLog();
  const { pathname } = useLocation();
  const here = runs.filter((r) => r.path === pathname);
  const byPath = new Map<string, { n: number; bytes: number }>();
  for (const r of runs) {
    const p = byPath.get(r.path) ?? { n: 0, bytes: 0 };
    p.n += 1;
    p.bytes += r.scannedBytes;
    byPath.set(r.path, p);
  }
  const fmt = (b: number) => `${(b / 1073741824).toLocaleString(appLocale(), { maximumFractionDigits: 3 })} GiB scanned`;
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
      <span style={{ ...type.heading }}>
        This page ran {here.length} {here.length === 1 ? "query" : "queries"}.
      </span>
      <span style={{ ...type.body, color: color.textSecondary }}>
        The app's own cost, for this browser session: the queries this page ran and the bytes Grail reports they
        scanned. Reading system events is usually reported as 0 bytes scanned.
      </span>
      {[...byPath.entries()].map(([p, v]) => (
        <span key={p} style={{ ...type.body }}>
          {p}: {v.n} {v.n === 1 ? "query" : "queries"}, {fmt(v.bytes)}
        </span>
      ))}
    </Card>
  );
}
