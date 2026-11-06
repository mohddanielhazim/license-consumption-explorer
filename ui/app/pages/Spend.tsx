import React, { useMemo, useState } from "react";
import { BarTip, useBarHover } from "../components/BarHover";
import { Link, useSearchParams } from "react-router-dom";

import { color, font, radius, space, type, size } from "../design/tokens";
import { Answer, Card, Dropdown, Label, SignalLabel, Tabs } from "../design/primitives";
import { Info } from "../components/Info";
import { Bone, DataAsOf, ENTITY_RESULT_RECORDS, QueryOutcome, RETENTION_DAYS, ShowQuery, asNumber, comparisonWindow, useAppHref, useBillingQuery, usePeriod } from "../components/shared";
import { useDiscovery } from "../components/useMeasuredQuery";
import { nativeDisplay, type Capability, capabilityLabel } from "../capabilities";
import { quantityOf } from "../funnel";
import { NotIncluded } from "../components/NotCharged";
import { MSG, NAME } from "../strings";
import { AT_SOURCE, formatCost, formatQuantity, sourcesLabel, useAmSnapshot, useRates, type RateSource, type Rates, SOURCE_LABEL } from "../rates";
import { usageQuery } from "./Usage";
import { billedCover } from "../data/contract";
import { dailyRange, median, niceStep, startsMidDay, stillArriving, utcDaysBetween } from "../data/math";
import { R } from "../routes";
import { PreviewTag, PriceTag } from "../components/Tags";
import { appLocale, appTimeZone, dayShiftMinutes, zoneLabel, formatDay, formatChangePct } from "../locale";
import { FocusExport } from "../components/FocusExport";
import { AmFacts } from "../components/AmFacts";

import { NextSteps } from "../components/NextSteps";
/**
 * Spend: cost at the rates in use, the burn line against
 * the commitment, usage against plan per capability, why it moved against the
 * previous period, and a what-if calculator. Every money figure carries its
 * rate source. Forecasts are ranges (lowest to highest 7-day average), never
 * a single number. The commitment and allowances are optional rate-card
 * fields; without them those parts say what they need.
 */
const DAY = 86400000;

type SpendView = "cost" | "burn" | "plan" | "moved" | "whatif";
const SPEND_VIEWS: { value: SpendView; label: string }[] = [
  { value: "cost", label: "Cost" },
  { value: "burn", label: "Commitment burn" },
  { value: "plan", label: "Usage against plan" },
  { value: "moved", label: "Why it moved" },
  { value: "whatif", label: "What if" },
];

/** Current period against the one before, per capability and entity. */
/**
 * One row per capability at any scale (v0.12.3): per entity first (previous
 * and current quantity), then per capability: change of entities in both
 * periods, entities only in the current one (new), only in the previous one
 * (stopped). Unlinked usage is the entity "" (counted, never as "new").
 */
const movementQuery = (qty: string, prevFrom: string, from: string, to: string, fetchTo: string) => `fetch dt.system.events, from: "${prevFrom}", to: "${fetchTo}"
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
| fieldsAdd usage_time = coalesce(toTimestamp(usage.start), toTimestamp(event.start), toTimestamp(query_start), timestamp)
| filter usage_time >= toTimestamp("${prevFrom}") and usage_time < toTimestamp("${to}")
| fieldsAdd half = if(usage_time < toTimestamp("${from}"), "previous", else: "current")
| fieldsAdd entity = coalesce(toString(dt.smartscape.host), dt.entity.host, dt.entity.cloud_application_namespace,
    toString(dt.smartscape.k8s_namespace), dt.entity.application, dt.entity.device_application, toString(dt.smartscape.frontend),
    dt.entity.synthetic_test, dt.entity.http_check, usage.bucket, workflow.id, ""),
    qty = ${qty}
| filter isNotNull(qty)
| summarize {prev = sum(if(half == "previous", qty, else: 0.0)), cur = sum(if(half == "current", qty, else: 0.0))},
    by:{event.type, entity}
| summarize {prev = sum(prev), cur = sum(cur),
    existing = sum(if(prev > 0 and cur > 0, cur - prev, else: 0.0)),
    added = sum(if(prev <= 0 and cur > 0, cur, else: 0.0)),
    stopped = sum(if(prev > 0 and cur <= 0, -prev, else: 0.0)),
    n_new = countIf(prev <= 0 and cur > 0 and entity != ""),
    n_stopped = countIf(prev > 0 and cur <= 0 and entity != "")},
    by:{event.type}`;

type Daily = { eventType: string; cap: Capability; total: number | null; days: Map<string, number> };

function dayKey(v: unknown): string | null {
  const d = typeof v === "object" && v !== null ? (v as { start?: string }).start : v;
  return typeof d === "string" ? d.slice(0, 10) : null;
}

function parseDaily(records: ReadonlyArray<Record<string, unknown> | null> | undefined, resolve: (t: string) => Capability) {
  const byType = new Map<string, Daily>();
  let last: string | null = null;
  for (const r of records ?? []) {
    if (!r) continue;
    const eventType = String(r["event.type"]);
    const cap = resolve(eventType);
    const q = quantityOf(r, cap);
    const row = byType.get(eventType) ?? { eventType, cap, total: null, days: new Map<string, number>() };
    if (q !== null) {
      row.total = (row.total ?? 0) + q;
      const k = dayKey(r.usage_day);
      if (k) row.days.set(k, (row.days.get(k) ?? 0) + q);
    }
    byType.set(eventType, row);
    if (typeof r.last_record === "string" && (!last || r.last_record > last)) last = r.last_record;
  }
  return { rows: [...byType.values()], last };
}

/** "List price, not your contract" mid-sentence. */
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Cost per day (user's time zone) across all priced capabilities, and which were priced. */
function costByDay(rows: Daily[], rates: Rates) {
  const days = new Map<string, number>();
  const sources = new Set<RateSource>();
  const unpriced: string[] = [];
  for (const row of rows) {
    if (row.total === null) continue;
    const r = rates.rateFor(row.eventType);
    if (!r) {
      unpriced.push(row.eventType);
      continue;
    }
    sources.add(r.source);
    for (const [d, q] of row.days) days.set(d, (days.get(d) ?? 0) + row.cap.toRateUnits(q) * r.value);
  }
  return { days, sources, unpriced };
}


/** "$2,419 to $2,778"; when both ends print the same, "about $103" (never "$103 to $103", which reads as exact). */
function moneyRange(currency: string, lo: number, hi: number) {
  const a = formatCost(lo, currency);
  const b = formatCost(hi, currency);
  return a === b ? `about ${b}` : `${a} to ${b}`;
}

const dateText = (t: number) =>
  new Date(t).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: appTimeZone() });

/** Spend for the period, the commitment burn and the period-on-period movement (v0.12.8: shared with the Home summary). */
export function useSpendData(options: { burn?: boolean } = {}) {
  const rates = useRates();
  const period = usePeriod();
  const { discovery, fields, resolve, qty } = useDiscovery();
  const ready = discovery.records !== undefined && discovery.records.length > 0;

  // 1. Spend in the chosen period.
  const usage = useBillingQuery(usageQuery(fields), { enabled: ready });
  const keys = useMemo(() => utcDaysBetween(period.fromIso, period.toIso, dayShiftMinutes()), [period.fromIso, period.toIso]);
  const daily = useMemo(() => parseDaily(usage.records, resolve), [usage.records, resolve]);
  const cost = useMemo(() => costByDay(daily.rows, rates), [daily.rows, rates]);
  const total = [...cost.days.values()].reduce((a, b) => a + b, 0);
  // A first day that starts mid-day holds only part of a day: leave it out of the pace range.
  const partialFirst = startsMidDay(period.fromIso, dayShiftMinutes());
  const range = dailyRange(cost.days, partialFirst ? keys.slice(1) : keys, Date.now(), dayShiftMinutes());

  // 1b. Finished UTC days Account Management billed (v0.12.25): their figure replaces the estimate,
  // and only the time around them is estimated from billing records, each part by its own query.
  const billedSnap = rates.contract?.billed && rates.contract.currency === rates.currency ? { ...rates.contract.billed, periodStart: rates.contract.periodStart, periodEnd: rates.contract.periodEnd } : null;
  const cover = billedSnap ? billedCover(period.fromIso, period.toIso, billedSnap) : null;
  const beforeWindow = cover && period.fromIso < cover.startIso
    ? { fromIso: period.fromIso, toIso: cover.startIso, fetchToIso: new Date(Math.min(Date.parse(cover.startIso) + DAY, Date.parse(period.fetchToIso))).toISOString() }
    : null;
  const afterWindow = cover && cover.endIso < period.toIso ? { fromIso: cover.endIso, toIso: period.toIso, fetchToIso: period.fetchToIso } : null;
  const before = useBillingQuery(usageQuery(fields), { enabled: ready && beforeWindow !== null, window: beforeWindow ?? period });
  const after = useBillingQuery(usageQuery(fields), { enabled: ready && afterWindow !== null, window: afterWindow ?? period });
  const partCost = (records: typeof usage.records) => [...costByDay(parseDaily(records, resolve).rows, rates).days.values()].reduce((a, b) => a + b, 0);
  const estimated = (beforeWindow ? partCost(before.records) : 0) + (afterWindow ? partCost(after.records) : 0);
  const anchored = cover
    ? {
        billed: cover.amount,
        days: cover.days,
        estimated,
        /** True when part of the timeframe lies outside the billed days. */
        hasRest: beforeWindow !== null || afterWindow !== null,
        total: cover.amount + estimated,
        /** What this app's own records price the billed days at: the gap to the bill is billed − this. */
        appCovered: total - estimated,
        isLoading: (beforeWindow !== null && before.isLoading) || (afterWindow !== null && after.isLoading),
        error: (beforeWindow ? before.error : null) ?? (afterWindow ? after.error : null),
      }
    : null;

  // 2. Burn line over the commitment window (only with a commitment).
  // A commitment saved in another currency than the rates in use is not compared (as edits and budgets).
  // With none typed on the Rate card, the commitment is Account Management's budget for the current period (v0.12.25).
  const snap = useAmSnapshot().value;
  const typedCommitment = rates.card?.commitment ?? null;
  const amCommitment =
    !typedCommitment && snap?.budget && snap.period && snap.budget.currency === rates.currency
      ? { amount: snap.budget.total, start: new Date(snap.period.start).toISOString(), end: new Date(snap.period.end).toISOString() }
      : null;
  const savedCommitment = typedCommitment ?? amCommitment;
  const commitmentFromAm = amCommitment !== null;
  const commitmentCurrencyOff = Boolean(typedCommitment && rates.card && rates.card.currency !== rates.currency);
  const commitment = commitmentCurrencyOff || (savedCommitment && !(savedCommitment.amount > 0)) ? null : savedCommitment;
  // The end of the chosen timeframe stands in for "now": it is fixed per refresh,
  // so the query text stays stable across renders.
  const now = Date.parse(period.toIso);
  const cStart = commitment ? Date.parse(commitment.start) : 0;
  const cEnd = commitment ? Date.parse(commitment.end) : 0;
  const floor = now - RETENTION_DAYS * DAY;
  const windowFrom = commitment ? new Date(Math.max(cStart, floor)).toISOString() : "";
  const windowTo = commitment ? new Date(Math.min(now, cEnd)).toISOString() : "";
  // The commitment window: same rule as every billing query, fetched 24 h past its end (never past the screen's own fetch end).
  const burnWindow = commitment
    ? { fromIso: windowFrom, toIso: windowTo, fetchToIso: new Date(Math.min(Date.parse(windowTo) + 86400000, Date.parse(period.fetchToIso))).toISOString() }
    : undefined;
  const burn = useBillingQuery(usageQuery(fields), { enabled: ready && commitment !== null && cStart < now && options.burn !== false, window: burnWindow });
  const burnDaily = useMemo(() => parseDaily(burn.records, resolve), [burn.records, resolve]);
  const burnCost = useMemo(() => costByDay(burnDaily.rows, rates), [burnDaily.rows, rates]);
  const burnKeys = useMemo(() => (commitment ? utcDaysBetween(windowFrom, windowTo, dayShiftMinutes()) : []), [commitment, windowFrom, windowTo]);

  // 4. Why it moved: the same length of time immediately before.
  const fromMs = Date.parse(period.fromIso);
  const toMs = Date.parse(period.toIso);
  const prevFromMs = Math.max(floor, fromMs - (toMs - fromMs));
  const prevTruncated = prevFromMs > fromMs - (toMs - fromMs);
  // Capabilities are discovered over both timeframes, so one billed before and not now is
  // still counted as stopped.
  const { arriving } = comparisonWindow(period);
  const moveDisc = useDiscovery({ fromIso: new Date(prevFromMs).toISOString(), toIso: period.toIso, fetchToIso: period.fetchToIso });
  const movedResolve = moveDisc.resolve;
  const moved = useBillingQuery(movementQuery(moveDisc.qty, new Date(prevFromMs).toISOString(), period.fromIso, period.toIso, period.fetchToIso), {
    enabled: (moveDisc.discovery.records?.length ?? 0) > 0,
  });

  return { movedResolve, arriving, discovery, fields, resolve, ready, qty, usage, keys, partialFirst, daily, cost, total, anchored, range, commitment, commitmentFromAm, snap, commitmentCurrencyOff, cStart, cEnd, now, windowFrom, windowTo, burn, burnDaily, burnCost, burnKeys, fromMs, toMs, prevFromMs, prevTruncated, moved };
}

export const Spend = () => {
  const rates = useRates();
  const period = usePeriod();
  // One view at a time, kept in the URL (?view=) so links and Back work.
  const [params, setParams] = useSearchParams();
  const view: SpendView = SPEND_VIEWS.some((v) => v.value === params.get("view")) ? (params.get("view") as SpendView) : "cost";
  const setView = (v: SpendView) => {
    const next = new URLSearchParams(params);
    if (v === "cost") next.delete("view");
    else next.set("view", v);
    setParams(next);
  };
  // The day opened in the spike explainer (?day=YYYY-MM-DD): a step Back can undo, and a link can share.
  const pickedDay = params.get("day");
  const setPickedDay = (d: string | null) => {
    const next = new URLSearchParams(params);
    if (d) next.set("day", d);
    else next.delete("day");
    setParams(next);
  };
  const href = useAppHref();
  const { movedResolve, arriving, discovery, resolve, ready, qty, usage, keys, partialFirst, daily, cost, total, anchored, range, commitment, commitmentFromAm, snap, commitmentCurrencyOff, cStart, cEnd, now, windowFrom, windowTo, burn, burnCost, burnKeys, fromMs, toMs, prevFromMs, prevTruncated, moved } = useSpendData();
  const discoveryState = discovery.isLoading || !ready;
  const spendFailed = Boolean(discovery.error ?? usage.error);
  const spendReady = !spendFailed && !discovery.isLoading && !usage.isLoading && !rates.isLoading && (usage.records?.length ?? 0) > 0;
  const currency = rates.currency;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[48] }}>
      <QueryOutcome
        query={usage.query}
        records={discoveryState ? discovery.records : usage.records}
        error={discovery.error ?? usage.error}
        errorKind={usage.errorKind}
        partial={usage.partial}
        isLoading={discovery.isLoading || usage.isLoading || rates.isLoading}
        retry={discovery.error ? discovery.retry : usage.retry}
        empty={`No billed usage recorded for ${period.phrase}.`}
        skeleton={<SpendSkeleton />}
      >
        {anchored && !anchored.isLoading && !anchored.error ? (
          <Answer
            setup="This period comes to"
            conclusion={`${formatCost(anchored.total, currency)}.`}
            lead={<BilledLead anchored={anchored} currency={currency} sources={cost.sources} />}
            delta={<SpendDelta records={moved.records} loading={moved.isLoading} resolve={movedResolve} rates={rates} days={Math.round((toMs - fromMs) / DAY)} truncated={prevTruncated} arriving={arriving} />}
          />
        ) : (
        <Answer
          // "This period cost" only when every figure is a contract rate; otherwise say which prices.
          setup={cost.sources.size === 1 && cost.sources.has("contract") ? "At your calculated contract rates this timeframe comes to" : cost.sources.size === 1 && cost.sources.has("list") ? "At list prices this timeframe would cost" : "At the rates in use this timeframe would cost"}
          conclusion={`${formatCost(total, currency)}.`}
          lead={
            <>
              {cost.sources.size ? `${period.phrase.charAt(0).toUpperCase()}${period.phrase.slice(1)}, at ${lowerFirst(sourcesLabel(cost.sources))}.` : `${period.phrase.charAt(0).toUpperCase()}${period.phrase.slice(1)}. No capability in this timeframe has a price, so no cost is shown.`}
              {range ? ` Estimated for a 30-day month: ${moneyRange(currency, range[0] * 30, range[1] * 30)}, going by ${NAME.rangeBasis}; new hosts or changed retention are not included.` : ""}
              <NotIncluded types={cost.unpriced} />
            </>
          }
          delta={<SpendDelta records={moved.records} loading={moved.isLoading} resolve={movedResolve} rates={rates} days={Math.round((toMs - fromMs) / DAY)} truncated={prevTruncated} arriving={arriving} />}
        />
        )}
        <span style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
          <PriceTag sources={cost.sources} />
          <DataAsOf last={daily.last} />
        </span>
      </QueryOutcome>

      <AmFacts snap={snap} contract={rates.contract} currency={currency} />

      {/* The views sit outside the spend query's outcome: if it fails, Why it moved and the burn line (own queries) stay reachable. */}
      {/* Commitment burn and Usage against plan appear once there is something to compare against (or when opened by link). */}
      <Tabs<SpendView>
        label="Spend views"
        value={view}
        onChange={setView}
        options={SPEND_VIEWS.filter(
          (o) =>
            o.value === view ||
            (o.value === "burn" ? Boolean(commitment) : o.value === "plan" ? Object.keys(rates.card?.allowances ?? {}).length > 0 : true),
        )}
      />
      {view === "cost" && spendReady && (
        <>
          <SpendBars keys={keys} partialFirst={partialFirst} startIso={period.fromIso} days={cost.days} currency={currency} picked={pickedDay && keys.includes(pickedDay) ? pickedDay : null} onPick={(d) => setPickedDay(d === pickedDay ? null : d)} />
          {pickedDay && keys.includes(pickedDay) && (
            <DayExplainer day={pickedDay} keys={keys} partialDay={partialFirst ? keys[0] : null} days={cost.days} rows={daily.rows} rates={rates} currency={currency} onClose={() => setPickedDay(null)} onWhyItMoved={() => setView("moved")} />
          )}
          <CapabilityCosts rows={daily.rows} rates={rates} total={total} />
          <FocusExport />
        </>
      )}

      {view === "burn" && <section id="burn" aria-label="Burn line" style={{ display: "flex", flexDirection: "column", gap: space[16], scrollMarginTop: space[24] }}>
        <SectionTitle
          preview
          title="Commitment burn"
          guide={{
            what: "Cost to date in the commitment period against a straight line from zero to the full commitment.",
            why: "Running ahead of the line means the commitment may run out before the period ends.",
            how: `Daily cost at the rates in use, added up. The run-out date is an estimate with a range: ${NAME.rangeBasis}.`,
            where: "The commitment comes from the Rate card.",
          }}
        />
        {commitmentCurrencyOff ? (
          <Card>
            <span style={{ ...type.body, color: color.textSecondary }}>
              Your commitment was saved in {rates.card?.currency}, but costs are now in {rates.currency}, so the burn line isn't drawn. Enter the commitment again on the{" "}
              <Link to={href(R.rates)} className="lc-link" style={{ color: color.textPrimary }}>
                Rate card
              </Link>
              .
            </span>
          </Card>
        ) : !commitment ? (
          <Card>
            <span style={{ ...type.body, color: color.textSecondary }}>
              No commitment set, so there is nothing to burn against. Add the annual commitment and its dates on the{" "}
              <Link to={href(R.rates)} className="lc-link" style={{ color: color.textPrimary }}>
                Rate card
              </Link>
              .
            </span>
          </Card>
        ) : cStart >= now ? (
          <Card>
            <span style={{ ...type.body, color: color.textSecondary }}>The commitment period starts on {dateText(cStart)}, so there is nothing to burn against yet.</span>
          </Card>
        ) : (
          <QueryOutcome
            query={burn.query}
            records={burn.records}
            error={burn.error}
            errorKind={burn.errorKind}
            partial={burn.partial}
            isLoading={burn.isLoading}
            retry={burn.retry} cancel={burn.cancel} cancelled={burn.cancelled}
            empty="No billed usage recorded in the commitment period."
            skeleton={<Bone w="100%" h={220} r={radius.surface} />}
          >
            {commitmentFromAm && (
              <span style={{ ...type.body, color: color.textSecondary }}>
                The commitment is Account Management&apos;s budget for the current period: {formatCost(commitment.amount, currency)}, {dateText(cStart)} to {dateText(cEnd)}.
              </span>
            )}
            <Burn
              amount={commitment.amount}
              asOf={Date.parse(windowTo)}
              start={cStart}
              end={cEnd}
              windowStart={Date.parse(windowFrom)}
              keys={burnKeys}
              days={burnCost.days}
              currency={currency}
              sources={burnCost.sources}
              unpriced={burnCost.unpriced}
            />
          </QueryOutcome>
        )}
      </section>}

      {view === "plan" && <section id="plan" aria-label="Usage against plan" style={{ display: "flex", flexDirection: "column", gap: space[16], scrollMarginTop: space[24] }}>
        <SectionTitle
          preview
          title="Usage against plan"
          guide={{
            what: "Each capability's usage in the timeframe against its share of the yearly allowance you planned.",
            why: "Shows which capability is running ahead of the allowance you set, in its own unit, before it shows up as cost.",
            how: "Share = yearly allowance × days in the timeframe ÷ 365. Within plan: under 90% of the share. Close to plan: 90 to 100%. Over plan: above 100%.",
            where: "Allowances are optional, per capability, on the Rate card.",
          }}
        />
        {spendFailed ? <NeedsSpend /> : <Plan rows={daily.rows} allowances={rates.card?.allowances ?? {}} days={(toMs - fromMs) / DAY} href={href} loading={usage.isLoading} />}
      </section>}

      {view === "moved" && <section id="moved" aria-label="Why it moved" style={{ display: "flex", flexDirection: "column", gap: space[16], scrollMarginTop: space[24] }}>
        <SectionTitle
          title="Why it moved"
          guide={{
            what: "The change against the period just before, of the same length, split into what drove it.",
            why: "More usage of the same hosts, apps or buckets is a different situation from new ones appearing.",
            how: "Per capability and entity: entities in both timeframes give the change in existing usage; entities only in this timeframe are new; entities only in the previous period stopped. Usage that is not linked to an entity is one pool.",
          }}
        />
        <QueryOutcome
          query={moved.query}
          records={moved.records}
          error={moved.error}
          errorKind={moved.errorKind}
          partial={moved.partial}
          isLoading={discovery.isLoading || moved.isLoading}
          retry={moved.retry} cancel={moved.cancel} cancelled={moved.cancelled}
          empty="No billed usage recorded in either period."
          skeleton={<Bone w="100%" h={240} r={radius.surface} />}
        >
          <Movement records={moved.records} resolve={movedResolve} rates={rates} truncated={prevTruncated} prevFrom={prevFromMs} from={fromMs} />
        </QueryOutcome>
        <TopMovers qty={qty} enabled={ready} prevFrom={new Date(prevFromMs).toISOString()} resolve={resolve} />
      </section>}

      {view === "whatif" && <section id="whatif" aria-label="What if" style={{ display: "flex", flexDirection: "column", gap: space[16], scrollMarginTop: space[24] }}>
        <SectionTitle
          title="What if"
          guide={{
            what: "How the cost of a timeframe like this changes if one capability's usage changes.",
            how: "The change is applied to the capability's cost at the pace of its slowest and its busiest 7 days in the timeframe, so the answer is a range.",
          }}
        />
        {spendFailed ? <NeedsSpend /> : <WhatIf rows={daily.rows} rates={rates} keys={partialFirst ? keys.slice(1) : keys} days={(toMs - fromMs) / DAY} />}
      </section>}

      <NextSteps links={[{ to: R.perHost, label: "See which hosts cost the most" }, { to: R.fixes, label: "Open Findings" }]} />
      <ShowQuery query={[usage.query, commitment ? burn.query : null, moved.query].filter(Boolean).join("\n\n")} />
    </div>
  );
};

/**
 * Top movers: the hosts, namespaces, apps, monitors,
 * buckets and workflows whose cost changed most against the previous period. Own query,
 * so a failure here leaves the capability table above intact. Changes are told with a
 * sign, an arrow and words, never by colour alone.
 */
const topMoversQuery = (qty: string, prevFrom: string, from: string, to: string, fetchTo: string) => `fetch dt.system.events, from: "${prevFrom}", to: "${fetchTo}"
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
| fieldsAdd usage_time = coalesce(toTimestamp(usage.start), toTimestamp(event.start), toTimestamp(query_start), timestamp)
| filter usage_time >= toTimestamp("${prevFrom}") and usage_time < toTimestamp("${to}")
| fieldsAdd half = if(usage_time < toTimestamp("${from}"), "previous", else: "current"),
    entity = coalesce(toString(dt.smartscape.host), dt.entity.host, dt.entity.cloud_application_namespace,
    toString(dt.smartscape.k8s_namespace), dt.entity.application, dt.entity.device_application, toString(dt.smartscape.frontend),
    toString(dt.smartscape.browser_monitor), toString(dt.smartscape.http_monitor), dt.entity.synthetic_test, dt.entity.http_check, usage.bucket, workflow.id, ""),
    wf_title = workflow.title,
    qty = ${qty}
| filter isNotNull(qty) and entity != ""
| summarize {prev = sum(if(half == "previous", qty, else: 0.0)), cur = sum(if(half == "current", qty, else: 0.0)), wf = takeMax(wf_title)},
    by:{event.type, entity}
| filter prev != cur
| lookup [fetch dt.entity.host | fields id, entity.name], sourceField: entity, lookupField: id, prefix: "host."
| lookup [fetch dt.entity.cloud_application_namespace | fields id, entity.name], sourceField: entity, lookupField: id, prefix: "ns."
| lookup [fetch dt.entity.application | fields id, entity.name], sourceField: entity, lookupField: id, prefix: "app."`;

function TopMovers({ qty, enabled, prevFrom, resolve }: { qty: string; enabled: boolean; prevFrom: string; resolve: (t: string) => Capability }) {
  const period = usePeriod();
  const rates = useRates();
  const q = useBillingQuery(topMoversQuery(qty, prevFrom, period.fromIso, period.toIso, period.fetchToIso), { enabled, maxRecords: ENTITY_RESULT_RECORDS });
  const movers = useMemo(() => {
    const byEntity = new Map<string, { name: string; id: string; delta: number; caps: Set<string> }>();
    for (const r of q.records ?? []) {
      if (!r) continue;
      const t = String(r["event.type"]);
      const rate = rates.rateFor(t);
      if (!rate) continue;
      const delta = resolve(t).toRateUnits(asNumber(r.cur) - asNumber(r.prev)) * rate.value;
      const id = String(r.entity);
      const name = [r["host.entity.name"], r["ns.entity.name"], r["app.entity.name"], r.wf].find((v) => typeof v === "string" && v) as string | undefined;
      const e = byEntity.get(id) ?? { name: name ?? id, id, delta: 0, caps: new Set<string>() };
      e.delta += delta;
      e.caps.add(capabilityLabel(t));
      byEntity.set(id, e);
    }
    const all = [...byEntity.values()].filter((e) => Math.abs(e.delta) >= 0.005);
    return {
      up: all.filter((e) => e.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5),
      down: all.filter((e) => e.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5),
    };
  }, [q.records, rates, resolve]);
  const list = (title: string, rows: typeof movers.up, arrow: string, word: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: space[8], minWidth: 0 }}>
      <span style={{ ...type.heading }}>{title}</span>
      {rows.length === 0 ? (
        <span style={{ ...type.body, color: color.textSecondary }}>None.</span>
      ) : (
        rows.map((m) => (
          <div key={m.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 140px", gap: space[16], padding: `${space[8]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
            <span style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
              <span style={{ ...type.body, color: color.textPrimary, overflowWrap: "anywhere" }}>{m.name}</span>
              <span style={{ ...type.body, color: color.textTertiary, overflowWrap: "anywhere" }}>{[...m.caps].join(", ")}</span>
            </span>
            {/* The arrow keeps a fixed slot on the left so arrows line up; the amount aligns right. */}
            <span style={{ ...type.body, display: "flex", justifyContent: "space-between", gap: space[8], whiteSpace: "nowrap" }}>
              <span aria-hidden="true">{arrow}</span>
              <span>
                {m.delta > 0 ? "+" : "−"}
                {formatCost(Math.abs(m.delta), rates.currency)}
                <span className="lc-visually-hidden"> {word}</span>
              </span>
            </span>
          </div>
        ))
      )}
    </div>
  );
  return (
    <section aria-label="Top movers" style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <h3 style={{ margin: 0, ...type.title }}>Top movers</h3>
      <span style={{ ...type.body, color: color.textSecondary }}>The hosts, namespaces, apps and buckets whose cost changed most against the previous period.</span>
      <QueryOutcome query={q.query} records={q.records} error={q.error} errorKind={q.errorKind} partial={q.partial} isLoading={q.isLoading} retry={q.retry} cancel={q.cancel} cancelled={q.cancelled} empty="Nothing linked to a host, app or bucket changed between the two periods." skeleton={<Bone w="100%" h={180} r={radius.surface} />}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: space[32] }}>
          {list("Rose the most", movers.up, "↑", "increase")}
          {list("Fell the most", movers.down, "↓", "decrease")}
        </div>
      </QueryOutcome>
    </section>
  );
}

/** The comparison sentence under the Spend headline: this period's cost against the one before, at the same rates. */
function SpendDelta({ records, loading, resolve, rates, days, truncated, arriving }: { records: ReadonlyArray<Record<string, unknown> | null> | undefined; loading: boolean; resolve: (t: string) => Capability; rates: Rates; days: number; truncated: boolean; arriving: boolean }) {
  if (truncated) return <span style={{ ...type.body, color: color.textTertiary }}>{MSG.compareTruncated}</span>;
  // Hold the line while its own query runs, so the page doesn't jump when it arrives.
  if (loading) return <Bone w="40%" h={24} />;
  let prev = 0;
  let cur = 0;
  for (const r of records ?? []) {
    if (!r) continue;
    const t = String(r["event.type"]);
    const rate = rates.rateFor(t);
    if (!rate) continue;
    prev += resolve(t).toRateUnits(asNumber(r.prev)) * rate.value;
    cur += resolve(t).toRateUnits(asNumber(r.cur)) * rate.value;
  }
  if (!(prev > 0)) return null;
  const pct = ((cur - prev) / prev) * 100;
  const span = `the previous ${days} ${days === 1 ? "day" : "days"}`;
  return (
    <span style={{ ...type.bodyLarge, color: color.textSecondary }}>
      <span aria-hidden="true">{Math.abs(pct) < 0.5 ? "→" : pct > 0 ? "↑" : "↓"} </span>
      {Math.abs(pct) < 0.5
        ? `About the same as ${span} (${formatCost(prev, rates.currency)}).`
        : `${pct > 0 ? "Up" : "Down"} ${formatChangePct(pct)} on ${span} (${formatCost(prev, rates.currency)}).`}
      {arriving ? MSG.compareArriving : ""}
    </span>
  );
}

/** Plan and What if read the spend figures: when that query failed, say so rather than "nothing set". */
/**
 * The lead under a total built from Account Management's figures (v0.12.25): what was
 * billed, for which finished days, what is estimated, and any gap between the bill and
 * this app's own records for the same days.
 */
function BilledLead({ anchored, currency, sources }: { anchored: NonNullable<ReturnType<typeof useSpendData>["anchored"]>; currency: string; sources: Set<RateSource> }) {
  const href = useAppHref();
  const n = anchored.days.length;
  const span = n === 1 ? formatDay(anchored.days[0]) : `${formatDay(anchored.days[0])} to ${formatDay(anchored.days[n - 1])}`;
  const gap = anchored.billed - anchored.appCovered;
  const showGap = anchored.billed > 0 && Math.abs(gap) / anchored.billed > 0.01;
  return (
    <>
      {`${formatCost(anchored.billed, currency)} as billed by Account Management for ${n} finished ${n === 1 ? "day" : "days"} (${span}, UTC days)`}
      {anchored.hasRest ? `, and ${formatCost(anchored.estimated, currency)} estimated from billing records for the rest${sources.size ? `, at ${lowerFirst(sourcesLabel(sources))}` : ""}.` : "."}
      {showGap && (
        <>
          {` For the billed days, this app's own records come to ${formatCost(anchored.appCovered, currency)}, ${formatCost(Math.abs(gap), currency)} ${gap > 0 ? "less" : "more"} than the bill. `}
          <Link to={href(R.reconcile)} className="lc-link" style={{ color: color.textPrimary }}>
            See why
          </Link>
          .
        </>
      )}
    </>
  );
}

function NeedsSpend() {
  return (
    <Card>
      <span style={{ ...type.body, color: color.textSecondary }}>This view needs the spend figures, and that query failed (see above). Retry it there.</span>
    </Card>
  );
}

function SectionTitle({ title, guide, preview }: { title: string; guide: React.ComponentProps<typeof Info>["guide"]; preview?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: space[8], flexWrap: "wrap" }}>
      <h2 style={{ margin: 0, ...type.title }}>{title}</h2>
      <Info label={title} guide={guide} />
      {preview && <PreviewTag />}
    </span>
  );
}

/** Axis labels: whole currency units, no cents. */
function axisMoney(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat(appLocale(), { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${Math.round(v)} ${currency}`;
  }
}


function SpendBars({ keys, partialFirst, startIso, days, currency, picked, onPick }: { keys: string[]; partialFirst: boolean; startIso: string; days: Map<string, number>; currency: string; picked: string | null; onPick: (d: string) => void }) {
  const hover = useBarHover(keys.length);
  // One tab stop for the whole chart (the picked day, else the peak); arrow keys move between days.
  const focusDay = (k: string) => document.querySelector<HTMLElement>(`[data-day="${k}"]`)?.focus();
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : null;
    if (j === null) return;
    e.preventDefault();
    focusDay(keys[Math.max(0, Math.min(keys.length - 1, j))]);
  };
  const max = Math.max(0, ...keys.map((k) => days.get(k) ?? 0));
  if (keys.length < 2 || max === 0) return null;
  const hk = hover.index === null ? null : keys[hover.index];
  const arrivingCount = keys.filter((k) => stillArriving(k, Date.now(), dayShiftMinutes())).length;
  const startTime = new Intl.DateTimeFormat(appLocale(), { hour: "numeric", minute: "2-digit", timeZone: appTimeZone() }).format(new Date(startIso));
  const peak = keys.reduce((a, k) => ((days.get(k) ?? 0) > (days.get(a) ?? 0) ? k : a), keys[partialFirst && keys.length > 1 ? 1 : 0]);
  // About four gridlines at round values; the top one is the axis maximum.
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const lines = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const H = 160;
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: space[12] }}>
      <div
        // A group, not an image: each day is a button that opens the spike explainer.
        role="group"
        aria-label={`Cost per day (${zoneLabel()}). Highest: ${formatCost(days.get(peak) ?? 0, currency)} on ${formatDay(peak)}. Select a day to see what drove it.`}
        style={{ display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${AXIS_W}px`, columnGap: space[12], height: H }}
      >
        <div {...hover.handlers} style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3 }}>
          {hk !== null && hover.index !== null && (
            <BarTip index={hover.index} count={keys.length}>
              {formatDay(hk)}: {formatCost(days.get(hk) ?? 0, currency)}
              {stillArriving(hk, Date.now(), dayShiftMinutes()) ? " (still arriving)" : ""}
            </BarTip>
          )}
          {lines.map((v) => (
            <span key={v} aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${(v / top) * 100}%`, borderTop: `1px solid ${color.line}`, pointerEvents: "none" }} />
          ))}
          {keys.map((k, i) => {
            const v = days.get(k) ?? 0;
            // Outlined: a day still arriving, or the first day when the timeframe starts mid-day (a few hours, not a dip).
            const arriving = stillArriving(k, Date.now(), dayShiftMinutes()) || (partialFirst && i === 0);
            // One strong mark: the picked day when there is one, else the peak. The rest recede.
            const strong = picked ? k === picked : k === peak;
            return (
              <button
                type="button"
                key={k}
                data-day={k}
                className="lc-bar"
                aria-label={`${formatDay(k)}: ${formatCost(v, currency)}${partialFirst && i === 0 ? ", part of a day" : arriving ? ", still arriving" : ""}. Show what drove this day.`}
                aria-pressed={k === picked}
                tabIndex={k === (picked ?? peak) ? 0 : -1}
                onClick={() => onPick(k)}
                onKeyDown={(e) => onKey(e, i)}
                style={{
                  position: "relative",
                  flex: 1,
                  minWidth: 1,
                  padding: 0,
                  cursor: "pointer",
                  height: `${Math.max(v > 0 ? 2 : 0, (v / top) * 100)}%`,
                  borderRadius: radius.marker,
                  background: arriving ? "transparent" : strong ? color.textPrimary : k === hk ? color.textSecondary : color.lineStrong,
                  border: arriving ? `1px solid ${color.lineStrong}` : "none",
                  boxSizing: "border-box",
                }}
              />
            );
          })}
        </div>
        <div aria-hidden="true" style={{ position: "relative" }}>
          {lines.map((v) => (
            <span
              key={v}
              style={{ position: "absolute", left: 0, bottom: `${(v / top) * 100}%`, transform: "translateY(50%)", ...type.mono, color: color.textTertiary, whiteSpace: "nowrap" }}
            >
              {axisMoney(v, currency)}
            </span>
          ))}
        </div>
      </div>
      {/* The two odd ends say what they are, right under them: a first day that starts part-way
          through (the timeframe begins at this moment N days ago) and days still arriving. */}
      {(partialFirst || arrivingCount > 0) && (
        <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `minmax(0, 1fr) ${AXIS_W}px`, columnGap: space[12], marginTop: -space[4] }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: space[16], ...type.label, color: color.textTertiary }}>
            <span>{partialFirst ? `from ${startTime}` : ""}</span>
            <span>{arrivingCount > 0 ? "still arriving" : ""}</span>
          </div>
        </div>
      )}
      {/* The same values for keyboard and screen-reader users (the hover labels are mouse-only). */}
      <div className="lc-visually-hidden">
      <table>
        <caption>Cost per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>
                {formatCost(days.get(k) ?? 0, currency)}
                {partialFirst && k === keys[0] ? ` (from ${startTime})` : stillArriving(k, Date.now(), dayShiftMinutes()) ? " (still arriving)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {/* One line at full width: the peak, what a click does, and the time zone. */}
      <figcaption style={{ ...type.body, color: color.textTertiary }}>
        Highest day {formatCost(days.get(peak) ?? 0, currency)} on {formatDay(peak)}. Select a day to see what drove it. Days in your time zone ({zoneLabel()}).
      </figcaption>
    </figure>
  );
}

/**
 * The spike explainer (v0.12.13): one day against a typical day (the median of
 * up to seven days before it in the timeframe), and the four capabilities whose
 * cost moved most. Read from the daily rows already loaded: no extra query.
 */
function DayExplainer({ day, keys, partialDay, days, rows, rates, currency, onClose, onWhyItMoved }: { day: string; keys: string[]; partialDay: string | null; days: Map<string, number>; rows: Daily[]; rates: Rates; currency: string; onClose: () => void; onWhyItMoved: () => void }) {
  const i = keys.indexOf(day);
  // A first day holding only a few hours is never "typical", and is not compared itself.
  const isPartial = day === partialDay;
  const prior = isPartial ? [] : keys.slice(Math.max(0, i - 7), i).filter((k) => k !== partialDay);
  const total = days.get(day) ?? 0;
  const typical = median(prior.map((k) => days.get(k) ?? 0));
  const diff = total - typical;
  const arriving = stillArriving(day, Date.now(), dayShiftMinutes());
  const sources = new Set<RateSource>();
  const drivers = rows
    .flatMap((r) => {
      const rate = rates.rateFor(r.eventType);
      if (!rate) return [];
      sources.add(rate.source);
      const cost = (k: string) => r.cap.toRateUnits(r.days.get(k) ?? 0) * rate.value;
      const that = cost(day);
      const usual = median(prior.map(cost));
      return [{ name: capabilityLabel(r.eventType), that, usual, change: that - usual }];
    })
    .filter((d) => Math.abs(d.change) >= 0.005)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4);
  const layer = sourcesLabel(sources).toLowerCase();
  const word = prior.length === 0 ? "" : Math.abs(diff) < 0.5 ? ", about the same as a typical day" : `, ${formatCost(Math.abs(diff), currency)} ${diff > 0 ? "more" : "less"} than a typical day`;
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(140px, 1fr)", gap: space[16], alignItems: "center" };
  return (
    <section aria-label={`What drove ${formatDay(day)}`} className="lc-panel" style={{ display: "flex", flexDirection: "column", gap: space[16], padding: space[24], borderRadius: radius.surface, background: color.surface1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: space[16], alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          <h2 style={{ margin: 0, ...type.title }}>
            {formatDay(day)} came to {formatCost(total, currency)}
            {word}.
          </h2>
          <span style={{ ...type.body, color: color.textSecondary }}>
            {isPartial
              ? `The timeframe starts part-way through this day, so it holds only a few hours. At ${layer}.`
              : prior.length
                ? `Typical: ${formatCost(typical, currency)}, ${prior.length === 1 ? "the one earlier day to compare with (small sample)" : `the median of the ${prior.length} days before`}, at ${layer}.`
                : `There is no earlier full day in this timeframe to compare with. At ${layer}.`}
            {arriving ? " This day is still arriving, so its figure may rise." : ""}
          </span>
        </div>
        <button type="button" className="lc-textbtn" onClick={onClose} style={{ ...type.body, border: 0, background: "transparent", color: color.textSecondary, padding: `${space[4]}px 0` }}>
          Close
        </button>
      </div>
      {prior.length > 0 && drivers.length > 0 && (
        <div role="table" aria-label={`Capabilities whose cost changed most on ${formatDay(day)}`} style={{ display: "flex", flexDirection: "column" }}>
          <div role="row" style={{ ...grid, padding: `0 ${space[8]}px ${space[8]}px` }}>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary }}>Capability</span>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>That day</span>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>Typical day</span>
            <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>Change</span>
          </div>
          {drivers.map((d) => (
            <div key={d.name} role="row" style={{ ...grid, padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
              <span role="cell" style={{ ...type.heading }}>{d.name}</span>
              <span role="cell" style={{ ...type.body, color: color.textSecondary, textAlign: "right" }}>{formatCost(d.that, currency)}</span>
              <span role="cell" style={{ ...type.body, color: color.textSecondary, textAlign: "right" }}>{formatCost(d.usual, currency)}</span>
              <span role="cell" style={{ ...type.body, fontWeight: 500, textAlign: "right" }}>
                <span aria-hidden="true">{d.change > 0 ? "↑ " : "↓ "}</span>
                {formatCost(Math.abs(d.change), currency)} {d.change > 0 ? "more" : "less"}
              </span>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="lc-link" onClick={onWhyItMoved} style={{ ...type.body, alignSelf: "flex-start", border: 0, background: "transparent", color: color.textPrimary, padding: 0, textDecoration: "underline", cursor: "pointer" }}>
        See the whole timeframe in Why it moved →
      </button>
    </section>
  );
}

/** Width of the chart's own axis column: labels never sit over the plot. */
const AXIS_W = 56;

function CapabilityCosts({ rows, rates, total }: { rows: Daily[]; rates: Rates; total: number }) {
  const priced = rows
    .flatMap((r) => {
      const rate = rates.rateFor(r.eventType);
      if (r.total === null || !rate) return [];
      return [{ r, cost: r.cap.toRateUnits(r.total) * rate.value, source: rate.source }];
    })
    .sort((a, b) => b.cost - a.cost);
  if (!priced.length) return null;
  return (
    <div role="table" aria-label="Cost by capability" style={{ display: "flex", flexDirection: "column" }}>
      <div role="row" style={{ ...grid3, padding: `0 ${space[8]}px ${space[8]}px` }}>
        <span role="columnheader" style={{ ...type.label, color: color.textTertiary }}>Capability</span>
        <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>Usage</span>
        <span role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: "right" }}>Cost</span>
      </div>
      {priced.map(({ r, cost, source }) => (
        <div key={r.eventType} role="row" style={{ ...grid3, padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
          <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            <span style={{ ...type.heading }}>{capabilityLabel(r.eventType)}</span>
            <span style={{ ...type.body, color: color.textTertiary }}>
              {total > 0 ? `${cost / total < 0.01 && cost > 0 ? "under 1" : Math.round((cost / total) * 100)}% of the total` : ""}
              {source !== "list" ? `, ${sourcesLabel([source])}` : ""}
            </span>
          </span>
          <span role="cell" style={{ ...type.body, color: color.textSecondary, textAlign: "right" }}>
            {formatQuantity(nativeDisplay(r.cap, r.total ?? 0))} {r.cap.nativeUnit}
          </span>
          <span role="cell" style={{ ...type.body, textAlign: "right", whiteSpace: "nowrap" }}>{formatCost(cost, rates.currency)}</span>
        </div>
      ))}
    </div>
  );
}

function Burn({
  amount,
  asOf,
  start,
  end,
  windowStart,
  keys,
  days,
  currency,
  sources,
  unpriced,
}: {
  amount: number;
  /** One reference moment for spent, elapsed and run-out: the end of the data shown. */
  asOf: number;
  start: number;
  end: number;
  windowStart: number;
  keys: string[];
  days: Map<string, number>;
  currency: string;
  sources: Set<RateSource>;
  unpriced: string[];
}) {
  const spent = keys.reduce((a, k) => a + (days.get(k) ?? 0), 0);
  const elapsed = Math.min(1, Math.max(0, (asOf - start) / (end - start)));
  const range = dailyRange(days, keys, Date.now(), dayShiftMinutes());
  const remaining = amount - spent;
  const runOut = range && remaining > 0 ? [asOf + (remaining / Math.max(range[1], 1e-9)) * DAY, asOf + (remaining / Math.max(range[0], 1e-9)) * DAY] : null;
  const ahead = spent > amount * elapsed;

  // Chart: cumulative cost against the straight plan line, across the whole commitment.
  const W = 640;
  const H = 180;
  const x = (t: number) => ((t - start) / (end - start)) * W;
  const y = (v: number) => H - (v / Math.max(amount, spent)) * H;
  let cum = 0;
  const points = keys.map((k) => {
    cum += days.get(k) ?? 0;
    return `${x(Date.parse(`${k}T00:00:00Z`) + DAY).toFixed(1)},${y(cum).toFixed(1)}`;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
      <span style={{ ...type.bodyLarge }}>
        {formatCost(spent, currency)} of {formatCost(amount, currency)} used ({Math.round((spent / amount) * 100)}%), with{" "}
        {Math.round(elapsed * 100)}% of the period gone.{" "}
        {ahead ? <SignalLabel>Running ahead of the line</SignalLabel> : <Label>On or behind the line</Label>}
      </span>
      <span style={{ ...type.body, color: color.textSecondary }}>
        {remaining <= 0
          ? `At ${lowerFirst(sourcesLabel(sources))}, estimated cost to date is ${formatCost(-remaining, currency)} above the commitment. Account Management shows what has been billed.`
          : runOut
            ? runOut[0] > end
              ? `Estimated at the pace seen so far: the commitment would last beyond the end of the period (${dateText(end)}).`
              : `Estimated at the pace seen so far: the commitment would run out between ${dateText(runOut[0])} and ${dateText(Math.min(runOut[1], end))}${runOut[1] > end ? " or last to the end" : ""}.`
            : "Fewer than 7 full days so far: too early for a run-out date."}{" "}
        {sourcesLabel(sources)}.<NotIncluded types={unpriced} />
        {windowStart > start ? ` Usage before ${dateText(windowStart)} is outside the 365 days of billing data and not counted.` : ""}
      </span>
      <svg viewBox={`-64 -8 ${W + 64} ${H + 16}`} role="img" aria-label="Cumulative cost against the even-pace line to the commitment; the table below has the figures" style={{ width: "100%", maxWidth: W + 64, height: "auto" }}>
        {(() => {
          const gridStep = niceStep(Math.max(amount, spent) / 4);
          return Array.from({ length: Math.floor(Math.max(amount, spent) / gridStep) + 1 }, (_, i) => i * gridStep).map((v) => (
            <g key={v}>
              <line x1={0} y1={y(v)} x2={W} y2={y(v)} stroke={color.line} strokeWidth={1} />
              <text x={-8} y={y(v) + 4} textAnchor="end" style={{ fontFamily: font.mono, fontSize: type.mono.fontSize, fill: color.textTertiary }}>
                {axisMoney(v, currency)}
              </text>
            </g>
          ));
        })()}
        <line x1={0} y1={H} x2={W} y2={y(amount)} stroke={color.lineStrong} strokeDasharray="4 4" strokeWidth={1} />
        <polyline points={`${x(windowStart).toFixed(1)},${H} ${points.join(" ")}`} fill="none" stroke={ahead ? color.signal : color.textPrimary} strokeWidth={2} />
      </svg>
      {/* The chart's figures for screen readers and keyboard users (every chart has one). */}
      <div className="lc-visually-hidden">
        <table>
          <caption>Cost to date per day against the commitment of {formatCost(amount, currency)}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Cost to date</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k, i) => (
              <tr key={k}>
                <th scope="row">{formatDay(k)}</th>
                <td>{formatCost(keys.slice(0, i + 1).reduce((a, d) => a + (days.get(d) ?? 0), 0), currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span style={{ display: "flex", gap: space[24], ...type.body, color: color.textTertiary, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[8] }}>
          <span style={{ width: 16, height: 0, borderTop: `2px solid ${ahead ? color.signal : color.textPrimary}` }} /> Cost to date
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[8] }}>
          <span style={{ width: 16, height: 0, borderTop: `1px dashed ${color.lineStrong}` }} /> Even pace to {formatCost(amount, currency)} by {dateText(end)}
        </span>
      </span>
    </div>
  );
}

type PlanState = "within" | "close" | "over";
const PLAN_LABEL: Record<PlanState, string> = { within: "Within plan", close: "Close to plan", over: "Over plan" };

function Plan({
  rows,
  allowances,
  days,
  href,
  loading,
}: {
  rows: Daily[];
  allowances: Record<string, number>;
  days: number;
  href: (p: string) => string;
  loading: boolean;
}) {
  if (loading) return <Bone w="100%" h={120} r={radius.surface} />;
  const planned = rows.filter((r) => allowances[r.eventType] !== undefined && r.total !== null);
  if (!planned.length) {
    return (
      <Card>
        <span style={{ ...type.body, color: color.textSecondary }}>
          No yearly allowances set, so there is no plan to compare against. Add the allowance per capability, in its own
          unit, on the{" "}
          <Link to={href(R.rates)} className="lc-link" style={{ color: color.textPrimary }}>
            Rate card
          </Link>
          .
        </span>
      </Card>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {planned.map((r) => {
        const used = nativeDisplay(r.cap, r.total ?? 0);
        const share = (allowances[r.eventType] * days) / 365;
        const pct = share > 0 ? used / share : Infinity;
        const state: PlanState = pct > 1 ? "over" : pct >= 0.9 ? "close" : "within";
        return (
          <div key={r.eventType} style={{ ...grid3, padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
            <span style={{ ...type.heading }}>{capabilityLabel(r.eventType)}</span>
            <span style={{ ...type.body, color: color.textSecondary, textAlign: "right" }}>
              {formatQuantity(used)} of {formatQuantity(share)} {r.cap.nativeUnit} ({Number.isFinite(pct) ? Math.round(pct * 100) : "—"}%)
            </span>
            <span style={{ textAlign: "right" }}>
              {state === "over" ? <SignalLabel>{PLAN_LABEL.over}</SignalLabel> : <Label>{PLAN_LABEL[state]}</Label>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type Move = { eventType: string; cap: Capability; existing: number; added: number; stopped: number; nNew: number; nStopped: number; prev: number; cur: number };

function Movement({
  records,
  resolve,
  rates,
  truncated,
  prevFrom,
  from,
}: {
  records: ReadonlyArray<Record<string, unknown> | null> | undefined;
  resolve: (t: string) => Capability;
  rates: Rates;
  truncated: boolean;
  prevFrom: number;
  from: number;
}) {
  const moves = useMemo(
    () =>
      (records ?? []).flatMap((r): Move[] => {
        if (!r) return [];
        const t = String(r["event.type"]);
        return [
          {
            eventType: t,
            cap: resolve(t),
            prev: asNumber(r.prev),
            cur: asNumber(r.cur),
            existing: asNumber(r.existing),
            added: asNumber(r.added),
            stopped: asNumber(r.stopped),
            nNew: asNumber(r.n_new),
            nStopped: asNumber(r.n_stopped),
          },
        ];
      }),
    [records, resolve],
  );

  const withCost = moves
    .map((m) => {
      const r = rates.rateFor(m.eventType);
      const toCost = (v: number) => (r ? m.cap.toRateUnits(v) * r.value : null);
      return { ...m, rate: r, delta: toCost(m.cur - m.prev) };
    })
    .filter((m) => Math.abs(nativeDisplay(m.cap, m.cur - m.prev)) > 0 || m.nNew || m.nStopped)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || a.eventType.localeCompare(b.eventType));

  const priced = withCost.filter((m) => m.delta !== null);
  const net = priced.reduce((a, m) => a + (m.delta ?? 0), 0);
  const sources = new Set(priced.map((m) => m.rate?.source).filter((s): s is RateSource => Boolean(s)));
  const fmt = (m: Move, v: number) => {
    const shown = nativeDisplay(m.cap, v);
    if (shown === 0) return "0";
    if (Math.abs(shown) < 0.001) return shown > 0 ? "up < 0.001" : "down < 0.001";
    return `${shown > 0 ? "+" : "−"}${formatQuantity(Math.abs(shown))}`;
  };

  if (!withCost.length) return <span style={{ ...type.body, color: color.textSecondary }}>No capability changed between the two periods.</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <span style={{ ...type.bodyLarge }}>
        {priced.length
          ? `Against ${dateText(prevFrom)} to ${dateText(from)}, cost ${net >= 0 ? "rose" : "fell"} by ${formatCost(Math.abs(net), rates.currency)} (${sourcesLabel(sources)}).`
          : `Against ${dateText(prevFrom)} to ${dateText(from)}.`}{" "}
        Rate changes: none counted. The app keeps one rate per capability, so every change here is a change in usage.
      </span>
      {truncated && (
        <span style={{ ...type.body, color: color.textTertiary }}>
          The previous period is cut short at the 365-day limit of billing data, so it is shorter than this one.
        </span>
      )}
      <div role="table" aria-label="Change by capability" style={{ display: "flex", flexDirection: "column" }}>
        <div role="row" style={{ ...grid5, padding: `0 ${space[8]}px ${space[8]}px` }}>
          {["Capability", "Existing usage", "New", "Stopped", "Cost change"].map((h, i) => (
            <span key={h} role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: i ? "right" : "left" }}>
              {h}
            </span>
          ))}
        </div>
        {withCost.map((m) => (
          <div key={m.eventType} role="row" style={{ ...grid5, padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
            <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
              <span style={{ ...type.heading }}>{capabilityLabel(m.eventType)}</span>
              <span style={{ ...type.body, color: color.textTertiary }}>{m.cap.nativeUnit}</span>
            </span>
            <span role="cell" style={cellR}>{fmt(m, m.existing)}</span>
            <span role="cell" style={cellR}>
              {fmt(m, m.added)}
              {m.nNew ? <span style={{ display: "block", color: color.textTertiary }}>{m.nNew} new</span> : null}
            </span>
            <span role="cell" style={cellR}>
              {fmt(m, m.stopped)}
              {m.nStopped ? <span style={{ display: "block", color: color.textTertiary }}>{m.nStopped} stopped</span> : null}
            </span>
            <span role="cell" style={{ ...cellR, color: color.textPrimary }}>
              {m.delta === null
                ? "No price"
                : Math.abs(m.delta) < 0.005
                  ? `${m.delta >= 0 ? "up" : "down"} ${formatCost(Math.abs(m.delta), rates.currency)}`
                  : `${m.delta >= 0 ? "+" : "−"}${formatCost(Math.abs(m.delta), rates.currency)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhatIf({ rows, rates, keys, days }: { rows: Daily[]; rates: Rates; keys: string[]; days: number }) {
  const priced = rows.filter((r) => r.total !== null && rates.rateFor(r.eventType)).sort((a, b) => a.eventType.localeCompare(b.eventType));
  const [picked, setPicked] = useState<string | null>(null);
  const [pct, setPct] = useState("");
  const row = priced.find((r) => r.eventType === picked) ?? priced[0];
  if (!row) return <span style={{ ...type.body, color: color.textSecondary }}>No priced capability in this timeframe to try.</span>;
  const rate = rates.rateFor(row.eventType);
  const change = Number(pct);
  const blank = pct.trim() === "";
  const valid = !blank && Number.isFinite(change) && change >= -100 && change <= 1000;
  const capDays = new Map([...row.days].map(([k, q]) => [k, row.cap.toRateUnits(q) * (rate?.value ?? 0)]));
  const range = dailyRange(capDays, keys, Date.now(), dayShiftMinutes());
  const lo = range ? range[0] * days * (change / 100) : null;
  const hi = range ? range[1] * days * (change / 100) : null;
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: space[24] }}>
      {/* One sentence of controls (v0.12.13): labels inline, every field 40 px, read left to right. */}
      <div style={{ display: "flex", gap: space[8], flexWrap: "wrap", alignItems: "center", ...type.bodyLarge }}>
        <label htmlFor="whatif-cap" style={{ color: color.textSecondary }}>Change</label>
        <Dropdown id="whatif-cap" value={row.eventType} onChange={setPicked} options={priced.map((r) => ({ value: r.eventType, label: r.eventType }))} />
        <label htmlFor="whatif-pct" style={{ color: color.textSecondary }}>usage by</label>
        <input id="whatif-pct" inputMode="decimal" placeholder="0" value={pct} onChange={(e) => setPct(e.target.value)} aria-invalid={!valid && !blank} className="lc-input" style={{ ...field, width: 80, textAlign: "right", borderColor: valid || blank ? color.lineStrong : color.signal }} />
        <span style={{ color: color.textSecondary }}>%</span>
      </div>
      {blank ? (
        <span style={{ ...type.body, color: color.textSecondary }}>Enter a percentage, for example 10 or −10, to see an estimated range.</span>
      ) : !valid ? (
        <span role="alert" style={{ ...type.body, color: color.signal }}>
          Enter a change between −100 and 1000 percent.
        </span>
      ) : lo === null || hi === null ? (
        <span style={{ ...type.body, color: color.textSecondary }}>Fewer than 7 full days of {row.eventType} in this timeframe: choose a longer timeframe.</span>
      ) : change === 0 ? (
        <span style={{ ...type.bodyLarge }}>No change.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          <span style={{ ...type.label, color: color.textTertiary }}>Estimated at {rates.rateFor(row.eventType) ? AT_SOURCE[rates.rateFor(row.eventType)!.source].replace(/^at /, "") : "the rates in use"}, over {Math.round(days)} days</span>
          <span style={{ ...type.title }}>
            <span aria-hidden="true">{change > 0 ? "↑ " : "↓ "}</span>
            {moneyRange(rates.currency, Math.min(Math.abs(lo), Math.abs(hi)), Math.max(Math.abs(lo), Math.abs(hi)))} {change > 0 ? "more" : "less"}
          </span>
          <span style={{ ...type.body, color: color.textSecondary }}>
            At {rate ? SOURCE_LABEL[rate.source].toLowerCase() : "the rates in use"}. Range: the quietest and busiest 7 days in the timeframe
            {formatCost(Math.abs(lo), rates.currency) === formatCost(Math.abs(hi), rates.currency) ? ", which cost the same, so one figure" : ""}; days outside it can be busier or quieter.
          </span>
        </div>
      )}
    </Card>
  );
}

/** One field style for the What if sentence: 40 px, the input border, the app's colours. */
const field: React.CSSProperties = {
  ...type.body,
  fontFamily: "inherit",
  height: size.control,
  padding: `0 ${space[12]}px`,
  borderRadius: radius.control,
  border: `1px solid ${color.lineStrong}`,
  background: color.surface1,
  color: color.textPrimary,
  boxSizing: "border-box",
};

function SpendSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[24] }}>
      <Bone w="60%" h={38} />
      <Bone w="75%" h={24} />
      <Bone w="100%" h={96} r={radius.chip} />
    </div>
  );
}

const grid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 2fr) minmax(160px, 1fr) 160px",
  gap: space[24],
  alignItems: "center",
};
const grid5: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, 2fr) repeat(4, minmax(96px, 1fr))",
  gap: space[16],
  alignItems: "center",
};
const cellR: React.CSSProperties = { ...type.body, color: color.textSecondary, textAlign: "right" };
