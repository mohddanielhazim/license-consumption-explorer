import React, { useMemo, type CSSProperties } from "react";
import { Tip, useTip } from "../components/Tip";
import { capabilityLabel } from "../capabilities";

import { color, radius, size, space, type, layout } from "../design/tokens";
import { Marker } from "../design/primitives";
import { Bone, QueryOutcome, periodPhrase, useAppHref, useTimeframe } from "../components/shared";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import {
  funnelQuery,
  STAGES,
  computeFunnel,
  parseFunnelRows,
  summarise,
  type CapabilitySummary,
  type StageId,
} from "../funnel";
import { useRates } from "../rates";
import { Headline } from "../components/Info";
import { NextSteps } from "../components/NextSteps";
import { R } from "../routes";
import { Link, useSearchParams } from "react-router-dom";

/**
 * The Overview: one answer, four steps, one detail panel. Every number and
 * name below is computed from the funnel query's live records; nothing is
 * hardcoded from the mockup.
 *
 * Counting rule: a usage type "passes" a step when any of its billing records
 * do (its furthest step reached). A type that stops at step N is one whose
 * furthest step is N-1. Types with no quantity field are left out of the
 * steps and named in the footer.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const display = capabilityLabel;
const isStorageType = (eventType: string) => /Ingest|Retain/.test(eventType);
const isQueryType = (eventType: string) => eventType.endsWith(" - Query");

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type Step = {
  id: StageId;
  title: string;
  check: string;
  passing: CapabilitySummary[];
  stopped: CapabilitySummary[];
  cost: number | null;
};

export const Overview = () => {
  const { query, records, error, isLoading, retry, cancel, cancelled, resolve } = useMeasuredQuery(funnelQuery);
  const rates = useRates();
  const [tf] = useTimeframe();
  // The selected step is in the URL (?step=), so a reload or a shared link opens the same panel.
  const [params, setParams] = useSearchParams();
  const stepParam = Number(params.get("step"));
  const picked: StageId | null = stepParam >= 1 && stepParam <= 4 ? (stepParam as StageId) : null;
  const setPicked = (id: StageId) => {
    const p = new URLSearchParams(params);
    p.set("step", String(id));
    setParams(p);
  };

  const rows = useMemo(() => (records ? parseFunnelRows(records, resolve) : []), [records, resolve]);
  const summaries = useMemo(() => summarise(rows), [rows]);
  // Every billed type counts in the steps, discovered ones included; types
  // without a quantity field are counted by their billing records.
  const counted = summaries;
  const noQuantity = summaries.filter((s) => s.cap.discovered && s.cap.quantity === "records");
  // counted as "billed" without saying so). Still counted, because the records exist; named here.
  const measuredZero = summaries.filter((s) => s.quantity === 0);

  // Cost replaces the counts whenever a rate source prices something: list
  // prices by default, contract rates once Account Management is connected,
  // and per-capability edits. Unpriced capabilities are named, not hidden.
  const funnel = !rates.isLoading && rows.length > 0 ? computeFunnel(rows, rates) : null;
  const costed = funnel !== null && funnel.sources.size > 0;

  const steps: Step[] = STAGES.map((st) => ({
    id: st.id,
    title: st.title,
    check: st.check,
    passing: counted.filter((s) => s.reached >= st.id),
    stopped: st.id === 1 ? [] : counted.filter((s) => s.reached === st.id - 1),
    cost: costed && funnel ? funnel.stages[st.id - 1].cost : null,
  }));

  // Default: the step the customer can act on, i.e. where a cost centre would
  // clear something. Otherwise the step where the most types stopped.
  const actionable = steps.find((s) => s.id === 3 && s.stopped.some((c) => c.cap?.chargeback === "yes"));
  const busiest = [...steps].filter((s) => s.stopped.length > 0).sort((a, b) => b.stopped.length - a.stopped.length)[0];
  const defaultStep = actionable?.id ?? busiest?.id ?? null;
  // A step opens when it has something to show: what stopped there, or for Used, what was billed.
  const opens = (st: Step) => st.stopped.length > 0 || (st.id === 1 && st.passing.length > 0);
  const selected = picked !== null && opens(steps[picked - 1]) ? picked : defaultStep;

  const total = steps[0].passing.length;
  const charged = steps[3].passing.length;
  const [setup, conclusion] =
    charged === 0
      ? ["None of your Dynatrace usage", "can be charged to a team yet."]
      : charged === total
        ? ["All of your Dynatrace usage", "can be charged to a team."]
        : [`${charged} of ${total} capabilities you use`, "can be charged to a team."];
  const tip = useTip("overview-checks");

  return (
    <>
      <main id="main" tabIndex={-1} className="lc-page lc-gutter" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: space[24], paddingTop: space[24], paddingBottom: space[16] }}>
        <QueryOutcome
          query={query}
          records={records}
          error={error}
          isLoading={isLoading}
          retry={retry} cancel={cancel} cancelled={cancelled}
          skeleton={<OverviewSkeleton />}
          empty={`No billing records matched for ${periodPhrase(tf)}. Either nothing was billed, or this environment names its billing fields differently.`}
        >
          <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
            <Headline>
              <span style={{ color: color.textTertiary }}>{setup}</span>{" "}
              <span style={{ color: color.textPrimary }}>{conclusion}</span>
            </Headline>
            <p style={{ margin: 0, ...type.bodyLarge, color: color.textSecondary }}>
              {total} {plural(total, "capability", "capabilities")} {plural(total, "has", "have")} billing records in {periodPhrase(tf)}.
              {measuredZero.length > 0 && ` ${listNames(measuredZero.map((z) => display(z.eventType)))} measured zero.`}{" "}
              {noQuantity.length > 0 &&
                ` ${listNames(noQuantity.map((s) => s.eventType))} ${plural(noQuantity.length, "has", "have")} no quantity field, so ${plural(noQuantity.length, "it is", "they are")} counted by billing records.`}
            </p>

          </section>

          {/* The tip sits directly under what it explains. First visit only. */}
          <div style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            <section aria-label="The four checks" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: space[8] }}>
              {steps.map((s, i) => (
                <StepCard
                  key={s.id}
                  step={s}
                  next={steps[i + 1]}
                  total={steps[0].passing.length}
                  selected={selected === s.id}
                  biggest={busiest?.id === s.id}
                  onPick={() => setPicked(s.id)}
                />
              ))}
            </section>
            {tip.show && <Tip onDismiss={tip.dismiss}>Select any check to see what is in it.</Tip>}
          </div>

          {selected === 1 && <UsedPanel used={steps[0].passing} />}
          {selected === 2 && <NotLinkedPanel stopped={steps[1].stopped} />}
          {selected === 3 && <NotOwnedPanel stopped={steps[2].stopped} />}
          {selected === 4 && <NotChargedPanel stopped={steps[3].stopped} />}
        </QueryOutcome>
        <NextSteps links={[{ to: R.ownership, label: "Give hosts and namespaces an owner" }, { to: R.budgets, label: "See cost per team" }]} />
      </main>

    </>
  );
};

function StepCard({
  step,
  next,
  total,
  selected,
  biggest,
  onPick,
}: {
  step: Step;
  next: Step | undefined;
  total: number;
  selected: boolean;
  /** The step where the most capabilities stop: the only one in the signal colour. */
  biggest: boolean;
  onPick: () => void;
}) {
  const passing = step.passing.length;
  const filled = passing > 0;
  const selectable = step.stopped.length > 0 || (step.id === 1 && step.passing.length > 0);
  const nameColor = filled ? color.textPrimary : color.textTertiary;

  const card: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    // 8 apart (was 12): the Overview fits 1440 x 900 with the first-visit tip showing.
    gap: space[8],
    padding: space[16],
    borderRadius: radius.surface,
    fontFamily: "inherit",
    color: color.textPrimary,
    textAlign: "left",
    boxSizing: "border-box",
    background: selected ? color.surface1 : "transparent",
    // line/strong passes 3:1 against the page in both themes; surface/3 did not.
    border: `1px solid ${selected ? color.accent : "transparent"}`,
    cursor: selectable ? "pointer" : "default",
  };

  const node: CSSProperties = {
    flex: "none",
    width: size.stepNode,
    height: size.stepNode,
    borderRadius: radius.full,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    ...type.body,
    fontWeight: 600,
    boxSizing: "border-box",
    ...(filled
      ? { background: color.textPrimary, color: color.bgBase }
      : { border: `1px dashed ${color.lineStrong}`, color: color.textTertiary }),
  };

  // Solid into a step that something reaches, dashed into the one nothing reaches.
  const track: CSSProperties | null = next
    ? next.passing.length > 0
      ? { flex: 1, height: 1, background: color.textPrimary, marginLeft: space[12], marginRight: -space[24] }
      : { flex: 1, height: 0, borderTop: `1px dashed ${color.lineStrong}`, marginLeft: space[12], marginRight: -space[24] }
    : null;

  const body = (
    <>
      <span style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <span style={node}>{step.id}</span>
        {track && <span style={track} />}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
        <span style={{ ...type.heading, color: nameColor }}>{step.title}</span>
        <span style={{ ...type.body, color: color.textSecondary, minHeight: 40 }}>{step.check}</span>
      </span>
      <span style={{ display: "flex", alignItems: "baseline", gap: space[8], flexWrap: "wrap" }}>
        {/* Consumption workspace (v0.10.0): the count of usage types is the figure;
            cost is secondary and keeps its rate-source label. */}
        <span key={passing} className="lc-num" style={{ ...type.title, color: nameColor }}>{passing}</span>
        <span style={{ ...type.body, color: color.textTertiary }}>
          {step.id === 1 ? `${plural(passing, "capability", "capabilities")} used` : `${plural(passing, "capability passes", "capabilities pass")}`}
        </span>
      </span>
      {/* The funnel narrowing, at a glance: the share of used types still passing.
          The count beside it says the same in words, so the bar is hidden from readers. */}
      <span aria-hidden="true" style={{ display: "block", height: space[4], borderRadius: radius.full, background: color.surface2, overflow: "hidden" }}>
        <span className="lc-grow" style={{ display: "block", height: "100%", transform: `scaleX(${total > 0 ? passing / total : 0})`, background: filled ? color.textPrimary : "transparent" }} />
      </span>
      {/* Cut (v0.12.32): a row of squares repeated the count a third time. The line keeps its height on every card so the four align. */}
      {/* Only the biggest leak is orange: one colour among neutrals is what draws the eye. */}
      {/* Attention by form as well as colour: the marker square plus words,
          as every SignalLabel has. */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: space[8], ...type.label, color: biggest ? color.signal : color.textSecondary, minHeight: 16 }}>
        {biggest && step.stopped.length > 0 && <Marker />}
        {step.stopped.length > 0 ? `${step.stopped.length} stopped here${biggest ? ", the most" : ""}` : ""}
      </span>
    </>
  );

  return selectable ? (
    <button type="button" className="lc-step" data-selectable="true" aria-pressed={selected} onClick={onPick} style={card}>
      {body}
    </button>
  ) : (
    <div className="lc-step" style={card}>
      {body}
    </div>
  );
}

const panel: CSSProperties = {
  borderRadius: radius.surface,
  background: color.surface1,
  padding: space[24],
  display: "flex",
  flexDirection: "column",
  gap: space[24],
};

/** A link styled as the primary button (navigation, so it is an <a>, not a <button>). */
const primaryLink: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: size.control,
  padding: `0 ${space[16]}px`,
  borderRadius: radius.control,
  // The panel's one action, like every primary button: the accent (v0.12.43).
  background: color.accent,
  color: color.onAccent,
  textDecoration: "none",
  ...type.body,
  fontWeight: 500,
  whiteSpace: "nowrap",
};

function PanelHead({ title, sub, aside }: { title: string; sub: string; aside?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: space[24] }}>
      <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: space[8] }}>
        <h2 style={{ margin: 0, ...type.title }}>{title}</h2>
        <span style={{ ...type.body, color: color.textSecondary }}>{sub}</span>
      </span>
      {aside && <span style={{ flex: "none" }}>{aside}</span>}
    </div>
  );
}

/** Step 2: nothing on the record to trace. */
const LINKED: Record<string, string> = {
  host: "A host",
  namespace: "A namespace",
  application: "An application",
  monitor: "A monitor",
};

// "primary": something a cost centre would fix; "muted": a limit of the export, stated in words.
// No row is orange: on the Overview only the biggest leak is.
type TypeRow = { key: string; name: string; middle: string; right: string; tone: "primary" | "muted" };

/**
 * and "and N more" looked thin and cramped next to Owned's list): one row per
 * type, with what it is linked to and what happens to it. Rows scroll inside the
 * panel past five, so the Overview itself never scrolls at 1440 x 900.
 */
function TypeRows({ rows }: { rows: TypeRow[] }) {
  return (
    // Focusable so keyboard users can scroll it (WCAG 2.1.1); labelled for screen readers.
    // Past five rows the list scrolls, and stops part-way through a row so it visibly continues
    //.
    <div role="list" tabIndex={0} aria-label={rows.length > 5 ? `Capabilities, ${rows.length}; scroll for all` : "Capabilities"} className="lc-scroll" style={{ maxHeight: rows.length > 5 ? 4.5 * 39 : undefined, overflowY: "auto" }}>
      {rows.map((r) => (
        <div
          key={r.key}
          role="listitem"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 1.4fr) minmax(140px, 0.8fr) minmax(260px, 1.8fr)",
            gap: space[24],
            alignItems: "center",
            padding: `${space[8]}px ${space[8]}px`,
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: space[12], minWidth: 0 }}>
            <Marker tone={r.tone} />
            <span style={{ ...type.heading, overflowWrap: "anywhere" }}>{r.name}</span>
          </span>
          <span style={{ ...type.body, color: color.textSecondary }}>{r.middle}</span>
          <span style={{ ...type.body, color: r.tone === "primary" ? color.textPrimary : color.textSecondary }}>{r.right}</span>
        </div>
      ))}
    </div>
  );
}

/** What a type's records name. Passing Traceable with no entity kind means its records name a person. */
const linkedText = (s: CapabilitySummary) =>
  s.cap?.linkedTo ? LINKED[s.cap.linkedTo] : s.reached >= 2 ? "A person" : isStorageType(s.eventType) ? "The environment only" : "Nothing";

/** Step 1: every type billed in the period, and how far each gets through the checks. */
function UsedPanel({ used }: { used: CapabilitySummary[] }) {
  const href = useAppHref();
  const n = used.length;
  const rows: TypeRow[] = [...used]
    .sort((a, b) => b.reached - a.reached || a.eventType.localeCompare(b.eventType))
    .map((s) => ({
      key: s.eventType,
      name: display(s.eventType),
      middle: linkedText(s),
      right: s.reached >= 4 ? "Passes every check" : `Stops at ${STAGES[s.reached].title}`,
      tone: s.reached >= 4 ? "primary" : "muted",
    }));
  return (
    <section className="lc-drop" style={{ ...panel, gap: space[12] }}>
      <PanelHead
        title={`${n} ${plural(n, "capability has", "capabilities have")} billing records.`}
        sub="Every capability with a billing record in this timeframe, and the check each one stops at."
        aside={
          <Link to={href(R.usage)} className="lc-btn lc-primary" style={primaryLink}>
            See usage per capability
          </Link>
        }
      />
      <TypeRows rows={rows} />
    </section>
  );
}

/** Step 2: billed, but the records name no host, app or person. */
function NotLinkedPanel({ stopped }: { stopped: CapabilitySummary[] }) {
  const href = useAppHref();
  const n = stopped.length;
  const rows: TypeRow[] = stopped.map((s) => ({
    key: s.eventType,
    name: display(s.eventType),
    middle: isStorageType(s.eventType) ? "Storage and processing" : "Usage",
    right: "No host, app or person on its records, so not in the Cost Allocation export.",
    tone: "muted",
  }));
  return (
    <section className="lc-drop" style={{ ...panel, gap: space[12] }}>
      <PanelHead
        title={`${n} ${plural(n, "capability is", "capabilities are")} not linked to anything.`}
        sub="Their billing records carry no host, app or person, so the Cost Allocation export cannot assign them to a team."
        aside={
          <Link to={href(R.notLinked)} className="lc-btn lc-primary" style={primaryLink}>
            Why each one isn&apos;t linked
          </Link>
        }
      />
      <TypeRows rows={rows} />
    </section>
  );
}

/** Step 3: linked to something, but no team owns it. The step you can fix. */
function NotOwnedPanel({ stopped }: { stopped: CapabilitySummary[] }) {
  const href = useAppHref();
  const n = stopped.length;
  const fixable = stopped.filter((s) => s.cap?.chargeback === "yes");
  const unconfirmed = stopped.filter((s) => s.cap?.chargeback === "unconfirmed");
  const byQuery = stopped.filter((s) => s.cap?.chargeback === "query");
  const excluded = stopped.filter((s) => s.cap?.chargeback === "no");
  // Each row states its own verdict, so the lead only says what is fixable.
  const sub =
    fixable.length > 0
      ? `At this check, a cost centre on the records would move on ${fixable.length} of these.`
      : "A cost centre on the records would not move any of these on. Each row says why.";
  const ordered = [...fixable, ...byQuery, ...unconfirmed, ...excluded];
  return (
    <section className="lc-drop" style={{ ...panel, gap: space[12] }}>
      <div>
        <PanelHead
          title={`${n} ${plural(n, "capability is", "capabilities are")} linked to something, but ${plural(n, "has", "have")} no owner yet.`}
          sub={sub}
          aside={
            fixable.length > 0 ? (
              // Opens Findings' tagging check (steps, documentation link, trade-off) already unfolded.
              <Link to={href(`${R.fixes}?open=untagged#untagged`)} className="lc-btn lc-primary" style={primaryLink}>
                How to set a cost centre
              </Link>
            ) : null
          }
        />
      </div>
      <TypeRows
        rows={ordered.map((s) => {
          const verdict = s.cap?.chargeback;
          const ok = verdict === "yes";
          return {
            key: s.eventType,
            name: s.eventType,
            middle: s.cap?.linkedTo ? LINKED[s.cap.linkedTo] : "An entity",
            right: ok
              ? `Would pass with a cost centre on each ${s.cap?.linkedTo ?? "entity"}`
              : verdict === "query"
                ? `Not in the Cost Allocation export. This app splits it by ${s.cap?.linkedTo ?? "entity"}.`
                : verdict === "unconfirmed"
                  ? "Cost Allocation support for this capability is not documented."
                  : "Not in the Cost Allocation export.",
            tone: ok ? "primary" : "muted",
          };
        })}
      />
    </section>
  );
}

/** Step 4: owned, but the Cost Allocation export leaves it out. */
function NotChargedPanel({ stopped }: { stopped: CapabilitySummary[] }) {
  const href = useAppHref();
  const n = stopped.length;
  const byPerson = (t: string) => isQueryType(t) || t === "Automation Workflow" || t.startsWith("AppEngine Functions");
  const allPeopleTypes = stopped.every((s) => byPerson(s.eventType));
  const rows: TypeRow[] = stopped.map((s) => ({
    key: s.eventType,
    name: display(s.eventType),
    middle: isQueryType(s.eventType) ? "The person who ran it" : s.eventType === "Automation Workflow" ? "The workflow's owner" : s.eventType.startsWith("AppEngine Functions") ? "The app's user" : linkedText(s),
    right: s.cap?.chargeback === "unconfirmed" ? "Not confirmed that the Cost Allocation export includes it." : "Not in the Cost Allocation export.",
    tone: "muted",
  }));
  return (
    <section className="lc-drop" style={{ ...panel, gap: space[12] }}>
      <PanelHead
        title={
          allPeopleTypes
            ? `${n} ${plural(n, "capability is", "capabilities are")} owned by a person, but left out of the Cost Allocation export.`
            : `${n} ${plural(n, "capability is", "capabilities are")} owned, but left out of the Cost Allocation export.`
        }
        sub={
          allPeopleTypes
            ? "The Cost Allocation export does not include queries or automations, even though each one names who ran it."
            : "The Cost Allocation export does not carry these, or it is not confirmed that it does."
        }
        aside={
          stopped.some((s) => byPerson(s.eventType)) ? (
            // Queries answers "who ran them": by app, dashboard and service account, and by person.
            <Link to={href(R.queries)} className="lc-btn lc-primary" style={primaryLink}>
              See who ran them
            </Link>
          ) : null
        }
      />
      <TypeRows rows={rows} />
    </section>
  );
}

/**
 * Loading state: the same blocks, paddings and line heights as the loaded
 * screen (two-line answer, context line, four step cards, the default panel),
 * so nothing moves when the data arrives. No numbers.
 */
function OverviewSkeleton() {
  const stepCard: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: space[16],
    padding: space[16],
    borderRadius: radius.surface,
    border: "1px solid transparent",
  };
  return (
    <div role="status" aria-label="Loading the overview" style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
        <Bone w="88%" h={38} />
        <Bone w="34%" h={38} />
        {/* The context line usually wraps to two lines (24px each). */}
        <span style={{ display: "flex", flexDirection: "column" }}>
          <Bone w="90%" h={24} />
          <Bone w="40%" h={24} />
        </span>
      </section>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: space[8] }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={stepCard}>
            <Bone w={size.stepNode} h={size.stepNode} r={radius.full} />
            <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
              <Bone w="45%" h={22} />
              <Bone w="80%" h={20} />
            </span>
            <Bone w="40%" h={38} />
            <span style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
              <Bone w="50%" h={size.marker} r={radius.marker} />
              <Bone w="55%" h={16} />
            </span>
          </div>
        ))}
      </section>
      <Bone w="100%" h={300} r={radius.surface} />
    </div>
  );
}
