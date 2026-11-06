import React from "react";

import { formatChangePct } from "../locale";
import { color, type } from "../design/tokens";
import { formatQuantity } from "../rates";
import { Bone, USAGE_TIME, asNumber, comparisonWindow, useBillingQuery, usePeriod } from "./shared";
import { MSG } from "../strings";

/**
 * One plain sentence comparing this period with the one just before it, of the
 * same length. Said with a sign,
 * an arrow and words, never colour alone (rule 25). Its own small query: if it
 * fails or the previous period has no data, the sentence is simply left out.
 */
export function PeriodDelta({ filter, quantity, unit, noun }: { filter: string; quantity: string; unit: string; noun?: string }) {
  const period = usePeriod();
  const from = Date.parse(period.fromIso);
  const to = Date.parse(period.toIso);
  const cmp = comparisonWindow(period);
  const prevFrom = cmp.prevFromIso;
  const q = useBillingQuery(`fetch dt.system.events, from: "${prevFrom}", to: "${period.fetchToIso}"
| filter event.kind == "BILLING_USAGE_EVENT" and ${filter}
| dedup event.id
| fieldsAdd usage_time = ${USAGE_TIME}
| filter usage_time >= toTimestamp("${prevFrom}") and usage_time < toTimestamp("${period.toIso}")
| summarize {prev = sum(if(usage_time < toTimestamp("${period.fromIso}"), toDouble(${quantity}), else: 0.0)), cur = sum(if(usage_time >= toTimestamp("${period.fromIso}"), toDouble(${quantity}), else: 0.0))}`);
  if (cmp.truncated) return <span style={{ ...type.body, color: color.textTertiary }}>{MSG.compareTruncated}</span>;
  // Hold the line while this query runs, so the page doesn't jump when it arrives.
  if (q.isLoading) return <Bone w="40%" h={24} />;
  const r = q.records?.[0];
  if (!r || q.error) return null;
  const prev = asNumber(r.prev);
  const cur = asNumber(r.cur);
  if (!(prev > 0)) return null;
  const pct = ((cur - prev) / prev) * 100;
  const days = Math.round((to - from) / 86400000);
  const span = days >= 1 ? `the previous ${days === 1 ? "day" : `${days} days`}` : "the previous period";
  const what = noun ? ` ${noun}` : "";
  const text =
    cur === 0
      ? `None in this timeframe, against ${formatQuantity(prev)} ${unit}${what} in ${span}.`
      : Math.abs(pct) < 0.5
      ? `About the same as ${span} (${formatQuantity(prev)} ${unit}${what}).`
      : `${pct > 0 ? "Up" : "Down"} ${formatChangePct(pct)} on ${span} (${formatQuantity(prev)} ${unit}${what}).`;
  return (
    <span style={{ ...type.bodyLarge, color: color.textSecondary }}>
      <span aria-hidden="true">{Math.abs(pct) < 0.5 ? "→" : pct > 0 ? "↑" : "↓"} </span>
      {text}
      {cmp.arriving && cur > 0 ? MSG.compareArriving : ""}
    </span>
  );
}
