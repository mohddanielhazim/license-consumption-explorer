import React, { useMemo, useState } from "react";
import { formatDayRange, formatMoment } from "../locale";
import { Link } from "react-router-dom";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";

import { color, space, type, layout } from "../design/tokens";
import { Answer, Card, Label, PrimaryButton, SignalLabel } from "../design/primitives";
import { Info } from "../components/Info";
import { fixedWindow, Bone, Crumbs, QueryOutcome, ShowQuery, useAppHref } from "../components/shared";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { funnelQuery, parseFunnelRows, summarise } from "../funnel";
import { closedDays, fetchCosts, type AmCosts, type AmFailure } from "../data/accountManagement";
import { R } from "../routes";
import { NextSteps } from "../components/NextSteps";
import { PreviewTag } from "../components/Tags";
import { sameCapability } from "../capabilities";
import { formatCost, formatQuantity, useAmConnection } from "../rates";

/**
 * Reconcile: Account Management's usage per capability
 * against the app's own deduplicated billed usage, over the same closed UTC
 * days, with the reason for any gap. Also lists cost per environment in the
 * subscription (multi-environment). Account Management is the billing source
 * of truth; this screen explains differences, it does not correct them.
 * NOT VERIFIED in the development environment: no Account Management connection there.
 */
const DAYS = 30;
const MATCH = 0.02;

function envId(): string | null {
  try {
    return getEnvironmentId();
  } catch {
    return null;
  }
}

/** "GiB-hours", "gibibyte hour", "GiBHour" all read as "gibhour"; plurals and spacing ignored. */
function unitKey(u: string): string {
  return u
    .toLowerCase()
    .replace(/gibibytes?/g, "gib")
    .replace(/gigabytes?/g, "gb")
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "")
    .replace(/s(?=hour|day)/, "");
}

/** How many Account Management units one app unit is: 1 when they agree, 100,000 for data points, else null (not comparable). */
function unitFactor(appUnit: string, amUnit: string): number | null {
  const a = unitKey(appUnit);
  const m = unitKey(amUnit);
  if (!a || !m) return null;
  if (a === m) return 1;
  if (a.replace(/^100000/, "") === m && a.startsWith("100000")) return 100000;
  return null;
}

export const Reconcile = () => {
  const conn = useAmConnection();
  const href = useAppHref();
  const window = useMemo(() => closedDays(DAYS), []);
  const usage = useMeasuredQuery((fields) => funnelQuery(fields), { window: fixedWindow(window.start, window.end) });
  const summaries = useMemo(() => summarise(usage.records ? parseFunnelRows(usage.records, usage.resolve) : []), [usage.records, usage.resolve]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AmCosts | AmFailure | null>(null);
  const env = envId();

  async function compare() {
    if (!conn.value) return;
    setBusy(true);
    setResult(await fetchCosts(conn.value, window.start, window.end, undefined, env ? [env] : undefined));
    setBusy(false);
  }

  if (conn.isLoading) return <Bone w="60%" h={38} />;
  if (!conn.value) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[32], maxWidth: layout.content }}>
        <Crumbs trail={[{ label: "Rate card", to: R.rates }, { label: "Reconcile" }]} />
        <Answer
          setup="Reconcile needs"
          conclusion="an Account Management connection."
          lead="This screen compares Account Management's usage with what this app counts from billing events, and explains any gap. It also lists cost for every environment in your subscription."
        />
        <PreviewTag />
        <Card>
          <span style={{ ...type.body, color: color.textSecondary }}>
            No connection is set up for your user.{" "}
            <Link to={href(R.amSetup)} className="lc-link" style={{ color: color.textPrimary }}>
              Connect Account Management
            </Link>{" "}
            (a one-time setup by an Account Management admin; read-only).
          </span>
        </Card>
        <NextSteps links={[{ to: R.rates, label: "See the rates in use" }, { to: R.spend, label: "Back to Spend" }]} />
      </div>
    );
  }

  const ok = result && result.ok ? result : null;
  // One row per capability: Account Management may split a capability over several items.
  const here = ok
    ? [...ok.usages
        .filter((u) => !env || u.environmentId === env)
        .reduce((m, u) => {
          const k = `${u.name}|${u.unit}`;
          const prev = m.get(k);
          return m.set(k, prev ? { ...prev, value: prev.value + u.value } : { ...u });
        }, new Map<string, (typeof ok.usages)[number]>())
        .values()]
    : [];
  const rows = here.map((u) => {
    const s = summaries.find((x) => sameCapability(x.eventType, u.name));
    const appUnit = s?.cap.rateUnit.replace(/^per /, "") ?? "";
    const appValue = s && s.quantity !== null ? s.cap.toRateUnits(s.quantity) : null;
    // Compare only like with like: the same unit, or raw data points against 100,000-point units.
    const factor = unitFactor(appUnit, u.unit);
    const app = appValue === null || factor === null ? null : appValue * factor;
    const diff = app === null || u.value === 0 ? null : (app - u.value) / u.value;
    return { name: u.name, unit: u.unit, am: u.value, app: appValue, appUnit, comparable: factor !== null, diff };
  });
  const matched = rows.filter((r) => r.diff !== null && Math.abs(r.diff) <= MATCH).length;
  const envTotals = ok
    ? [...ok.costs.reduce((m, c) => m.set(c.environmentId, (m.get(c.environmentId) ?? 0) + c.value), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])
    : [];
  const currency = ok?.costs.find((c) => c.currency)?.currency ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <Crumbs trail={[{ label: "Rate card", to: R.rates }, { label: "Reconcile" }]} />
      <Answer
        setup={ok ? `${matched} of ${rows.length} capabilities` : "Compare with Account Management"}
        conclusion={ok ? `match Account Management within ${MATCH * 100}%.` : `over the last ${DAYS} closed UTC days.`}
        lead={`${formatDayRange(window.start, window.end)} (UTC days). This screen explains differences; it does not correct them.`}
      />
      <PreviewTag />
      <QueryOutcome
        query={usage.query}
        records={usage.records}
        error={usage.error}
        errorKind={usage.errorKind}
        isLoading={usage.isLoading}
        retry={usage.retry} cancel={usage.cancel} cancelled={usage.cancelled}
        empty="No billing records in these days, so there is nothing to compare."
        skeleton={<Bone w="100%" h={120} />}
      >
        <div style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
          <PrimaryButton onClick={busy ? undefined : () => void compare()}>{busy ? "Asking Account Management…" : ok ? "Compare again" : "Compare now"}</PrimaryButton>
          {ok?.lastModifiedTime && (
            <span style={{ ...type.body, color: color.textTertiary }}>Account Management data last updated {formatMoment(new Date(ok.lastModifiedTime))}.</span>
          )}
        </div>
        {result && !result.ok && (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            <span style={{ ...type.heading }}>Account Management didn&apos;t answer at the {result.step} step.</span>
            <span style={{ ...type.body, color: color.textSecondary }}>{result.message}</span>
          </div>
        )}
        {ok && (
          <section aria-label="Usage comparison" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            <span style={{ display: "flex", alignItems: "center", gap: space[8] }}>
              <h2 style={{ margin: 0, ...type.title }}>Usage, this environment</h2>
              <Info
                label="Usage comparison"
                guide={{
                  what: "Account Management's usage per capability next to this app's count from billing events, over the same closed UTC days.",
                  why: "If the two disagree, figures built on billing events (rates, cost per team) inherit the gap.",
                  how: "Usual causes: records still arriving (Account Management updates later), a different unit, usage recorded in another environment, or rounding to billing intervals.",
                  where: "Account Management usage API and dt.system.events.",
                }}
              />
            </span>
            {rows.length === 0 ? (
              <span style={{ ...type.body, color: color.textSecondary }}>Account Management returned no usage for this environment in these days.</span>
            ) : (
              rows.map((r) => (
                <div key={r.name} style={{ display: "grid", gridTemplateColumns: "minmax(200px, 2fr) repeat(2, minmax(120px, 1fr)) minmax(160px, 1.4fr)", gap: space[16], padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}`, alignItems: "center" }}>
                  <span style={{ ...type.heading }}>{r.name}</span>
                  <span style={{ ...type.body, color: color.textSecondary, textAlign: "right" }}>
                    Account Management: {formatQuantity(r.am)} {r.unit}
                  </span>
                  <span style={{ ...type.body, color: color.textSecondary, textAlign: "right" }}>
                    This app: {r.app === null ? "no records" : `${formatQuantity(r.app)} ${r.appUnit}`}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {r.diff === null ? (
                      <Label>Not comparable</Label>
                    ) : Math.abs(r.diff) <= MATCH ? (
                      <Label>Matches</Label>
                    ) : (
                      <SignalLabel>{`App counts ${Math.round(Math.abs(r.diff) * 100)}% ${r.diff > 0 ? "more" : "less"}`}</SignalLabel>
                    )}
                  </span>
                </div>
              ))
            )}
          </section>
        )}
        {ok && envTotals.length > 0 && (
          <section aria-label="Environments" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            <h2 style={{ margin: 0, ...type.title }}>Cost per environment in the subscription</h2>
            {envTotals.map(([id, total]) => (
              <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: space[16], padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ ...type.heading }}>{id === env ? "This environment" : "Environment"}</span>
                  <span style={{ ...type.mono, color: color.textTertiary }}>{id}</span>
                </span>
                <span style={{ ...type.body }}>{formatCost(total, currency || "USD")}</span>
              </div>
            ))}
            <span style={{ ...type.body, color: color.textTertiary }}>
              Other environments are shown as totals only: this app can read billing events of this environment alone.
            </span>
          </section>
        )}
      </QueryOutcome>
      <ShowQuery query={usage.query} />
    </div>
  );
};
