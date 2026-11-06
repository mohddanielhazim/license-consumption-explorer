import React, { useMemo, type ReactNode } from "react";
import { formatChangePct } from "../locale";
import { capabilityLabel } from "../capabilities";
import { Link } from "react-router-dom";

import { color, radius, space, type } from "../design/tokens";
import { Answer, Card, Label } from "../design/primitives";
import { Bone, asNumber, useAppHref, usePeriod } from "../components/shared";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { PriceTag } from "../components/Tags";
import { STAGES, computeFunnel, funnelQuery, parseFunnelRows, summarise, type StageId } from "../funnel";

/** Why usage stops at each check, in plain words (the Overview has the detail). */
const STOP_REASON: Record<StageId, string> = {
  1: "was not billed",
  2: "has billing records that name no host, app or person",
  3: "has no cost centre and is not run by a person",
  4: "is left out of the Cost Allocation export",
};
import { formatCost, sourcesLabel, useRates, type RateSource } from "../rates";
import { R } from "../routes";
import { useSpendData } from "./Spend";
import { estimateSentence, useFixList } from "./Fixes";

/**
 * Home (v0.12.8): the whole picture in four answers, each one number, one
 * sentence and the screen that has the detail. No charts: this is where people
 * land, so it stays calm. Every figure comes from the same calculation as the
 * screen it links to, so the two always agree.
 */
export const Home = () => {
  const period = usePeriod();
  const rates = useRates();
  const href = useAppHref();
  // Home shows no burn line, so it skips the (up to 365-day) burn query.
  const spend = useSpendData({ burn: false });
  const billed = spend.anchored && !spend.anchored.isLoading && !spend.anchored.error ? spend.anchored : null;
  const fixes = useFixList();
  const funnelQ = useMeasuredQuery(funnelQuery);

  // 1. Spend, and the capability that costs the most.
  const top = useMemo(() => {
    let best: { name: string; cost: number } | null = null;
    for (const r of spend.daily.rows) {
      const rate = rates.rateFor(r.eventType);
      if (!rate || r.total === null) continue;
      const c = r.cap.toRateUnits(r.total) * rate.value;
      if (!best || c > best.cost) best = { name: capabilityLabel(r.eventType), cost: c };
    }
    return best;
  }, [spend.daily.rows, rates]);

  // 2. What changed against the period before, at the same rates.
  const movedRecords = spend.moved.records;
  const resolve = spend.movedResolve;
  const change = useMemo(() => {
    let net = 0;
    let before = 0;
    let priced = 0;
    let biggest: { name: string; delta: number } | null = null;
    const sources = new Set<RateSource>();
    for (const r of movedRecords ?? []) {
      if (!r) continue;
      const t = String(r["event.type"]);
      const rate = rates.rateFor(t);
      if (!rate) continue;
      const delta = resolve(t).toRateUnits(asNumber(r.cur) - asNumber(r.prev)) * rate.value;
      net += delta;
      before += resolve(t).toRateUnits(asNumber(r.prev)) * rate.value;
      priced++;
      sources.add(rate.source);
      if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { name: capabilityLabel(t), delta };
    }
    return { net, before, priced, biggest, sources };
  }, [movedRecords, resolve, rates]);
  const days = Math.round((spend.toMs - spend.fromMs) / 86400000);

  // 3. How much reaches a team, and the check where most of it stops.
  const funnel = useMemo(() => {
    if (!funnelQ.records || rates.isLoading) return null;
    const rows = parseFunnelRows(funnelQ.records, funnelQ.resolve);
    if (!rows.length) return null;
    const f = computeFunnel(rows, rates);
    const summaries = summarise(rows);
    const used = f.stages[0].cost;
    const charged = f.stages[3].cost;
    let stop: { id: StageId; lost: number } | null = null;
    for (let i = 1; i < 4; i++) {
      const lost = f.stages[i - 1].cost - f.stages[i].cost;
      if (lost > 0.005 && (!stop || lost > stop.lost)) stop = { id: STAGES[i].id, lost };
    }
    return {
      costed: f.sources.size > 0,
      used,
      charged,
      sources: f.sources,
      types: summaries.length,
      chargedTypes: summaries.filter((s) => s.reached >= 4).length,
      stop,
    };
  }, [funnelQ.records, funnelQ.resolve, rates]);

  const spendLoading = spend.discovery.isLoading || spend.usage.isLoading || rates.isLoading;
  const pct = (part: number, whole: number) => (whole <= 0 ? 0 : part > 0 && part / whole < 0.01 ? "under 1" : Math.round((part / whole) * 100));
  const headline: [string, string] | null =
    spend.moved.isLoading || spend.moved.error || !change.priced || change.before <= 0.005
      ? null
      : Math.abs(change.net / change.before) < 0.005
        ? ["Cost this timeframe", `is about the same as the ${days} days before.`]
        : ["Cost this timeframe", `is ${change.net > 0 ? "up" : "down"} ${formatChangePct((change.net / change.before) * 100)} on the ${days} days before.`];
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatCost(Math.abs(v), rates.currency)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      {/* The one answer an executive opens Home for: up or down on the period
          before, from the same comparison as the "What changed" card, so the two always agree. */}
      <Answer
        setup={headline ? headline[0] : "Your Dynatrace subscription"}
        conclusion={headline ? headline[1] : `at a glance, ${period.phrase}.`}
        lead={headline ? `Your Dynatrace subscription at a glance, ${period.phrase}. Both periods priced at the same rates.` : undefined}
      />
      {spend.cost.sources.size > 0 && (
        <span style={{ display: "flex" }}>
          <PriceTag sources={spend.cost.sources} />
        </span>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space[16] }}>
        {/* With Account Management figures for finished days, the tile shows the same total as Spend. */}
        <Tile
          label={billed ? "Cost, billed and estimated" : spend.cost.sources.size === 1 && spend.cost.sources.has("list") ? "Cost at list price" : spend.cost.sources.size === 1 && spend.cost.sources.has("contract") ? "Cost at your contract rates (calculated)" : "Cost at rates in use"}
          loading={spendLoading || Boolean(spend.anchored?.isLoading)}
          failed={Boolean(spend.usage.error ?? spend.discovery.error ?? spend.anchored?.error)}
          value={formatCost(billed ? billed.total : spend.total, rates.currency)}
          to={href(R.spend)}
          action="See spend by day and capability"
        >
          {billed
            ? `${formatCost(billed.billed, rates.currency)} as billed by Account Management for ${billed.days.length} finished ${billed.days.length === 1 ? "day" : "days"}${billed.hasRest ? "; the rest estimated" : ""}.`
            : spend.cost.sources.size ? `At ${sourcesLabel(spend.cost.sources).toLowerCase()}.` : ""}
          {top ? ` The largest part is ${top.name}, ${pct(top.cost, spend.total)}% of the ${billed ? "cost at the rates in use" : "total"}.` : ""}
        </Tile>

        <Tile
          label="What changed"
          loading={spendLoading || spend.moved.isLoading}
          // Either query failing is a failure, never "No change".
          failed={Boolean(spend.moved.error ?? spend.usage.error ?? spend.discovery.error)}
          value={change.priced ? signed(change.net) : "No change"}
          to={href(`${R.spend}?view=moved`)}
          action="See why it moved"
        >
          {change.priced
            ? `Against the ${days} days before.${change.biggest && Math.abs(change.biggest.delta) >= 0.005 ? ` The biggest change is ${change.biggest.name}, ${signed(change.biggest.delta)}.` : ""}`
            : `Nothing priced changed against the ${days} days before.`}
          {spend.prevTruncated ? " The earlier period is cut short by the 365-day limit of billing data." : ""}
        </Tile>

        <Tile
          label="Charged to a team"
          loading={funnelQ.isLoading || rates.isLoading}
          failed={Boolean(funnelQ.error)}
          value={funnel ? (funnel.costed ? `${pct(funnel.charged, funnel.used)}%` : `${funnel.chargedTypes} of ${funnel.types}`) : "Nothing billed"}
          to={href(R.overview)}
          action="See what stops it"
        >
          {funnel
            ? (funnel.costed
                ? funnel.charged > 0.005
                  ? `Of this timeframe's usage, ${formatCost(funnel.charged, rates.currency)} (${sourcesLabel(funnel.sources).toLowerCase()}) would appear under a team in the Cost Allocation export.`
                  : "None of this timeframe's usage can be charged to a team yet."
                : `${funnel.chargedTypes} of ${funnel.types} capabilities can be charged to a team.`) +
              (funnel.stop ? ` Most of ${funnel.charged > 0.005 || !funnel.costed ? "the rest" : "it"} ${STOP_REASON[funnel.stop.id]}.` : "")
            : "No billing records in this timeframe."}
        </Tile>

        <Tile
          label="Worth reviewing"
          loading={fixes.loading || rates.isLoading}
          failed={fixes.checked.length === 0 && fixes.failed.length > 0}
          value={`${fixes.review.length} of ${fixes.checked.length}`}
          signal={fixes.review.length > 0}
          to={href(R.fixes)}
          action="Open Findings"
        >
          {fixes.review.length
            ? `Checks found something to review.${fixes.upTo > 0 ? ` ${estimateSentence(rates, fixes.upFrom, fixes.upTo, fixes.sources)}` : ""}`
            : "Nothing worth reviewing in this timeframe."}
        </Tile>
      </div>
    </div>
  );
};

/** One answer: label, one figure, one sentence, and the way to the detail. */
function Tile({
  label,
  value,
  children,
  to,
  action,
  loading,
  failed,
  signal,
}: {
  label: string;
  value: string;
  children: ReactNode;
  to: string;
  action: string;
  loading: boolean;
  failed: boolean;
  signal?: boolean;
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[12], borderRadius: radius.surface }}>
      <Label style={signal ? { color: color.signal } : undefined}>{label}</Label>
      {loading ? (
        <>
          <Bone w="45%" h={38} />
          <Bone w="90%" h={20} />
          <Bone w="70%" h={20} />
        </>
      ) : failed ? (
        <span style={{ ...type.body, color: color.textSecondary }}>This couldn't be loaded. Open the screen to try again.</span>
      ) : (
        <>
          <span style={{ ...type.display }}>{value}</span>
          <span style={{ ...type.body, color: color.textSecondary }}>{children}</span>
        </>
      )}
      <Link to={to} className="lc-link" style={{ ...type.body, color: color.textPrimary, marginTop: "auto", alignSelf: "flex-start" }}>
        {action} →
      </Link>
    </Card>
  );
}
