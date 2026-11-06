import React, { useState } from "react";
import { Link } from "react-router-dom";

import { color, space, type } from "../design/tokens";
import { Card } from "../design/primitives";
import { formatCost, type AmSnapshot, type ContractRates } from "../rates";
import { formatDay, formatMoment } from "../locale";
import { R } from "../routes";
import { useAppHref } from "./shared";

/**
 * Spend: what Account Management itself says (v0.12.25), from the figures saved when
 * rates were last calculated: budget and period, Dynatrace's forecast, cost in the
 * other environments, and Dynatrace's own cost alerts. Shown only when saved.
 */
export function AmFacts({ snap, contract, currency }: { snap: AmSnapshot | null; contract: ContractRates | null; currency: string }) {
  const href = useAppHref();
  if (!snap) return null;
  const lines: React.ReactNode[] = [];
  const money = (v: number) => formatCost(v, currency);

  if (snap.budget && snap.budget.currency === currency) {
    const b = snap.budget;
    lines.push(
      `Budget ${money(b.total)}` +
        (b.used !== null ? `, ${money(b.used)} used` : "") +
        (snap.period ? ` in the period ${formatDay(snap.period.start)} to ${formatDay(snap.period.end)}` : "") +
        (snap.period?.daysRemaining != null ? `, ${snap.period.daysRemaining} days left` : "") +
        ".",
    );
  }
  if (snap.forecast) {
    const f = snap.forecast;
    lines.push(
      `Dynatrace forecasts ${money(f.median)} for the period` +
        (f.lower !== null && f.upper !== null ? ` (between ${money(f.lower)} and ${money(f.upper)})` : "") +
        (f.budgetPct !== null ? `, ${Math.round(f.budgetPct)}% of the budget` : "") +
        (f.budgetDate ? `; the budget would run out around ${formatDay(f.budgetDate)}` : "") +
        ".",
    );
  }
  if (snap.accountByDay && snap.accountCurrency === currency && contract?.billed) {
    const all = Object.values(snap.accountByDay).reduce((a, b) => a + b, 0);
    const other = all - contract.billed.total;
    if (all > 0) {
      lines.push(
        `Across every environment in the subscription, Account Management billed ${money(all)} from ${formatDay(snap.periodStart)} to ${formatDay(new Date(Date.parse(snap.periodEnd) - 86400000).toISOString())}` +
          (other > 0.005 ? `; ${money(other)} of it is from other environments, which this app does not see.` : "; all of it in this environment."),
      );
    }
  }

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <h2 style={{ margin: 0, ...type.heading  }}>From Account Management</h2>
      {lines.map((l, i) => (
        <span key={i} style={{ ...type.body, color: color.textSecondary }}>
          {l}
        </span>
      ))}
      {snap.alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          <span style={{ ...type.label, color: color.textSecondary }}>Dynatrace cost alerts</span>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space[4] }}>
            {snap.alerts.slice(0, 5).map((a, i) => (
              <li key={i} style={{ ...type.body, color: color.textSecondary }}>
                {/* Severity in words, not colour alone. */}
                <span style={{ color: a.severity === "SEVERE" || a.severity === "WARN" ? color.signal : color.textSecondary }}>
                  {a.severity === "SEVERE" ? "Severe" : a.severity === "WARN" ? "Warning" : "Info"}
                </span>
                {`, ${formatDay(a.date)}: ${a.message}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {snap.missing.length > 0 && (
        <span style={{ ...type.body, color: color.textTertiary }}>Not available from Account Management: {snap.missing.map((m) => m.part.toLowerCase()).join(", ")}.</span>
      )}
      <span style={{ ...type.body, color: color.textTertiary }}>
        As read on {formatMoment(new Date(snap.computedAt))}.{" "}
        <Link to={href(R.amSetup)} className="lc-link" style={{ color: color.textPrimary }}>
          Read again
        </Link>
      </span>
    </Card>
  );
}

/**
 * Team budgets: Dynatrace's own cost per cost centre for this environment (Cost
 * Allocation report), over the days read when rates were last calculated, so the
 * app's split can be checked against Dynatrace's.
 */
export function AmAllocation({ snap, currency }: { snap: AmSnapshot | null; currency: string }) {
  const [all, setAll] = useState(false);
  if (!snap?.allocation || snap.allocation.length === 0) return null;
  const total = snap.allocation.reduce((a, r) => a + r.cost, 0);
  const shown = all ? snap.allocation : snap.allocation.slice(0, 10);
  const rest = snap.allocation.length - shown.length;
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <h2 style={{ margin: 0, ...type.heading  }}>Dynatrace&apos;s own split by cost centre</h2>
      <span style={{ ...type.body, color: color.textSecondary }}>
        From Account Management&apos;s Cost Allocation report for this environment, {formatDay(snap.periodStart)} to{" "}
        {formatDay(new Date(Date.parse(snap.periodEnd) - 86400000).toISOString())}: {formatCost(total, currency)} in all.
        {!snap.allocationComplete && " The report had more pages than the app reads, so this list is incomplete."}
      </span>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
        {shown.map((r) => (
          <li key={r.key ?? "(none)"} style={{ display: "flex", justifyContent: "space-between", gap: space[16], padding: `${space[8]}px ${space[8]}px`, borderTop: `1px solid ${color.line}`, ...type.body }}>
            <span style={{ color: r.key ? color.textPrimary : color.textSecondary }}>{r.key ?? "No cost centre"}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCost(r.cost, currency)}</span>
          </li>
        ))}
      </ul>
      {(rest > 0 || all) && (
        <button
          type="button"
          className="lc-link"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          style={{ ...type.body, alignSelf: "flex-start", padding: 0, border: 0, background: "transparent", color: color.textPrimary, textDecoration: "underline", cursor: "pointer" }}
        >
          {all ? "Show fewer" : `Show all ${snap.allocation.length} cost centres`}
        </button>
      )}
    </Card>
  );
}
