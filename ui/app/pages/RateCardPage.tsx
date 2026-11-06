import { formatDay, formatDayRange } from "../locale";
import React, { useEffect, useMemo, useState } from "react";
import { NOT_CHARGED } from "../data/listPrices";
import { NotChargedLink } from "../components/NotCharged";
import { TextInput } from "@dynatrace/strato-components/forms";
import { showToast } from "@dynatrace/strato-components/notifications";

import { color, space, type } from "../design/tokens";
import { Answer, Card, PrimaryButton } from "../design/primitives";
import { useWarnUnsaved, AppLinkTo, DefaultSkeleton, usePeriod } from "../components/shared";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { CAPABILITIES, type Capability } from "../capabilities";
import { funnelQuery, parseFunnelRows, summarise } from "../funnel";
import { SOURCE_LABEL, formatCost, formatRate, useRateCard, useRates, type RateCard } from "../rates";
import { R } from "../routes";
import { LIST_PRICE_SOURCE } from "../data/listPrices";

/**
 * Rate card. Per user, validated input:
 * validate on blur, then re-validate on every change after the first error.
 * Units beside every field. Blank means "not set", never 0.
 */

const RATE_DECIMALS = 6;
const AMOUNT_DECIMALS = 2;

/** null = valid (including blank); otherwise the message to show. */
export function checkNumber(raw: string, decimals: number, what: "rate" | "amount" | "allowance"): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const re = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (re.test(t)) return null;
  return `Enter ${what === "amount" ? "an amount" : what === "allowance" ? "an allowance" : "a rate"} of 0 or more, with up to ${decimals} decimal places.`;
}

function checkDate(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? null : "Enter a date as YYYY-MM-DD.";
}

/** A text field that validates on blur, then on every change once it has shown an error. */
export function Field({
  id,
  label,
  unit,
  value,
  onChange,
  check,
  placeholder,
}: {
  id: string;
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  check: (v: string) => string | null;
  placeholder?: string;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <span style={{ ...type.body, color: color.textSecondary }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: space[8] }}>
        <TextInput
          id={id}
          value={value}
          placeholder={placeholder ?? "Not set"}
          aria-invalid={shown !== null}
          aria-describedby={shown ? `${id}-msg` : undefined}
          onChange={(v) => {
            onChange(v);
            if (errored) setShown(check(v));
          }}
          onBlur={() => {
            const m = check(value);
            setShown(m);
            if (m) setErrored(true);
          }}
        />
        {unit && <span style={{ ...type.body, color: color.textTertiary, whiteSpace: "nowrap" }}>{unit}</span>}
      </span>
      {shown && (
        <span id={`${id}-msg`} role="alert" style={{ ...type.body, color: color.signal }}>
          {shown}
        </span>
      )}
    </label>
  );
}

const toInput = (n: number | undefined) => (n === undefined ? "" : String(n));

export const RateCardPage = () => {
  const { card, isLoading, error, save } = useRateCard();
  const active = useRates();
  const { records, resolve, isLoading: billedLoading } = useMeasuredQuery(funnelQuery);
  const period = usePeriod();
  const summaries = useMemo(() => summarise(records ? parseFunnelRows(records, resolve) : []), [records, resolve]);
  const present = useMemo(() => new Set(summaries.map((s) => s.eventType)), [summaries]);
  const capabilities: Capability[] = useMemo(() => {
    const known = new Set(CAPABILITIES.map((c) => c.eventType));
    const discovered = summaries.filter((s) => !known.has(s.eventType) && !s.unpriceable).map((s) => s.cap);
    return [...CAPABILITIES, ...discovered];
  }, [summaries]);

  // Edits are in the currency of the active rate source (contract or USD list).
  const currency: string | null = active.isLoading ? null : active.currency;
  const [rates, setRates] = useState<Record<string, string>>({});
  const [allowances, setAllowances] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  useEffect(() => {
    if (!card) return;
    setRates(Object.fromEntries(Object.entries(card.rates).map(([k, v]) => [k, String(v)])));
    setAllowances(Object.fromEntries(Object.entries(card.allowances).map(([k, v]) => [k, String(v)])));
    setAmount(toInput(card.commitment?.amount));
    setStart(card.commitment?.start.slice(0, 10) ?? "");
    // Stored end is exclusive (the day after the last day); the form shows the last day.
    const endInput = card.commitment ? new Date(Date.parse(card.commitment.end) - 86400000).toISOString().slice(0, 10) : "";
    setEnd(endInput);
    setSavedSnapshot(
      JSON.stringify({
        rates: Object.fromEntries(Object.entries(card.rates).map(([k, v]) => [k, String(v)])),
        allowances: Object.fromEntries(Object.entries(card.allowances).map(([k, v]) => [k, String(v)])),
        amount: toInput(card.commitment?.amount),
        start: card.commitment?.start.slice(0, 10) ?? "",
        end: endInput,
      }),
    );
  }, [card]);

  const rateErrors = capabilities.filter((c) => checkNumber(rates[c.eventType] ?? "", RATE_DECIMALS, "rate"));
  const allowanceErrors = capabilities.filter((c) => checkNumber(allowances[c.eventType] ?? "", AMOUNT_DECIMALS, "allowance"));
  const commitmentPartial = [amount, start, end].some((x) => x.trim()) && ![amount, start, end].every((x) => x.trim());
  const datesOrdered = !start || !end || Date.parse(end) > Date.parse(start);
  const fieldError = checkNumber(amount, AMOUNT_DECIMALS, "amount") ?? checkDate(start) ?? checkDate(end);
  const groupError = !datesOrdered
    ? "The end date must be after the start date."
    : commitmentPartial
      ? "Enter all three: amount, start date and end date, or leave all three blank."
      : null;
  // Unsaved edits: ask before the tab closes.
  const snapshot = JSON.stringify({ rates, allowances, amount, start, end });
  useWarnUnsaved(savedSnapshot !== null && snapshot !== savedSnapshot);
  const canSave = currency !== null && rateErrors.length === 0 && allowanceErrors.length === 0 && !fieldError && !groupError;

  async function onSave() {
    if (!currency) return;
    const nums = (src: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(src)
          .filter(([, v]) => v.trim() !== "")
          .map(([k, v]) => [k, Number(v)]),
      );
    const next: RateCard = {
      currency,
      rates: nums(rates),
      allowances: nums(allowances),
      commitment: amount.trim()
        ? { amount: Number(amount), start: `${start}T00:00:00.000Z`, end: new Date(Date.parse(`${end}T00:00:00.000Z`) + 86400000).toISOString() }
        : null,
      savedAt: new Date().toISOString(),
    };
    setSaving(true);
    setSaveError(null);
    try {
      await save(next);
      setSavedSnapshot(snapshot);
      showToast({ type: "success", title: "Rate card saved", message: `${Object.keys(next.rates).length} rates in ${currency}.` });
    } catch (e) {
      setSaveError(`Your rate card couldn't be saved: ${e instanceof Error ? e.message : String(e)}. Try again.`);
    } finally {
      setSaving(false);
    }
  }

  // Until billing is known, "not billed" would be a false statement about every capability.
  if (isLoading || billedLoading) return <DefaultSkeleton />;

  // Capabilities billed in the selected period first: those are the ones that need a rate.
  const ordered = [...capabilities].sort(
    (a, b) => Number(present.has(b.eventType)) - Number(present.has(a.eventType)) || a.eventType.localeCompare(b.eventType),
  );
  const unit = (c: Capability) => `${currency ?? "currency"} ${c.rateUnit}`;
  // What you are billed for is open; the rest of the catalogue folds away.
  const billedCaps = ordered.filter((c) => present.has(c.eventType));
  const otherCaps = ordered.filter((c) => !present.has(c.eventType));
  // With contract rates connected: which billed capabilities still fall back to the list price, or have no price.
  const listFallback = billedCaps.filter((c) => active.rateFor(c.eventType)?.source === "list");
  const noPrice = billedCaps.filter((c) => active.rateFor(c.eventType) === null && !NOT_CHARGED[c.eventType]);
  const renderCard = (c: Capability) => (
            <Card key={c.eventType} style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
              <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
                <h3 style={{ margin: 0, ...type.heading  }}>{c.eventType}</h3>
                <span style={{ ...type.body, color: color.textTertiary }}>
                  {present.has(c.eventType) ? `Billed in ${period.phrase}` : `Not billed in ${period.phrase}`}
                  {c.discovered ? ", unit read from the field name, not verified" : ""}
                </span>
              </span>
              {(() => {
                const r = active.rateFor(c.eventType);
                return (
                  <span style={{ ...type.body, color: r ? color.textPrimary : color.textTertiary }}>
                    {r
                      ? `In use: ${formatRate(r.value, active.currency)} ${c.rateUnit}, ${SOURCE_LABEL[r.source]}`
                      : NOT_CHARGED[c.eventType]
                        ? <>No price: <NotChargedLink /> ({NOT_CHARGED[c.eventType].replace(/.*\((.*)\)/, "$1")}).</>
                        : "No price: not in cost totals until you edit it."}
                  </span>
                );
              })()}
              <Field
                id={`r-${c.eventType}`}
                label="Edit rate (optional)"
                unit={unit(c)}
                value={rates[c.eventType] ?? ""}
                onChange={(v) => setRates({ ...rates, [c.eventType]: v })}
                check={(v) => checkNumber(v, RATE_DECIMALS, "rate")}
              />
              <Field
                id={`a-${c.eventType}`}
                label="Yearly allowance"
                unit={c.nativeUnit}
                value={allowances[c.eventType] ?? ""}
                onChange={(v) => setAllowances({ ...allowances, [c.eventType]: v })}
                check={(v) => checkNumber(v, AMOUNT_DECIMALS, "allowance")}
              />
            </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <Answer
        setup={active.isLoading ? "Prices" : active.contract ? "Your contract rates (calculated)" : "List prices"}
        conclusion={(() => {
          const own = Object.keys(card?.rates ?? {}).length;
          return own > 0 ? `price this app, with ${own} rate${own === 1 ? "" : "s"} you edited.` : "price every figure in this app.";
        })()}
        lead="Your contract rates when Account Management is connected; otherwise Dynatrace's public list prices, labelled as such on every figure. You can override any rate here for your user only, and set an optional commitment and allowances for the Spend screen."
      />
      {error && (
        <Card>
          <span style={{ ...type.body }}>
            Your saved rate card couldn't be read ({error}). You can still enter rates; saving will replace it.
          </span>
        </Card>
      )}

      <Card style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
        <h2 style={{ margin: 0, ...type.heading  }}>Where the rates come from</h2>
        {active.contract ? (
          <span style={{ ...type.body, color: color.textSecondary }}>
            {SOURCE_LABEL.contract}: Account Management cost divided by billed usage for{" "}
            {formatDayRange(active.contract.periodStart, active.contract.periodEnd)} (closed UTC days),
            subscription {active.contract.subscriptionName}, in {active.contract.currency}.
            {active.contract.billed &&
              ` Account Management billed this environment ${formatCost(active.contract.billed.total, active.contract.currency)} over those days.`}
            {active.contract.billed && active.contract.billed.unmatched.length > 0 &&
              ` ${formatCost(active.contract.billed.unmatched.reduce((a, u) => a + u.value, 0), active.contract.currency)} of it is for capabilities with no billing records in this environment, so Spend's billed total includes it but no breakdown does: ${active.contract.billed.unmatched.map((u) => u.name).join(", ")}.`}
            {active.contract.billed && (active.contract.billed.bookedLater ?? 0) > 0.005 &&
              ` ${formatCost(active.contract.billed.bookedLater ?? 0, active.contract.currency)} of it was booked on a later day than it was used, so Dynatrace's billing report lists it under the later date; this app counts it on the day it was used.`}
          </span>
        ) : (
          <span style={{ ...type.body, color: color.textSecondary }}>
            {SOURCE_LABEL.list}: Dynatrace public list prices in {LIST_PRICE_SOURCE.currency} (rate card page updated{" "}
            {formatDay(LIST_PRICE_SOURCE.pageModified)}). Connect Account Management to use your contract rates instead.
          </span>
        )}
        {active.contract && listFallback.length + noPrice.length > 0 && (
          // Capabilities with no contract rate: Account Management showed no cost for them in those days (or the
          // names didn't match), so they keep the list price, or have none when the contract is not in USD.
          <span style={{ ...type.body, color: color.textSecondary }}>
            Contract rates cover {billedCaps.length - listFallback.length - noPrice.length} of {billedCaps.length} capabilities billed in {period.phrase}.
            {listFallback.length > 0 &&
              ` ${listFallback.length === 1 ? "This one uses" : `These ${listFallback.length} use`} the list price, because Account Management showed no cost for ${listFallback.length === 1 ? "it" : "them"} in those days: ${listFallback.map((c) => c.eventType).join(", ")}.`}
            {noPrice.length > 0 &&
              ` ${noPrice.length === 1 ? "This one has" : `These ${noPrice.length} have`} no price until you add one below (list prices are in USD): ${noPrice.map((c) => c.eventType).join(", ")}.`}
          </span>
        )}
        {active.editsIgnored && (
          <span role="status" style={{ ...type.body, color: color.signal }}>
            Your edited rates were saved in {card?.currency} and are not applied while rates are in {active.currency}.
          </span>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[24] }}>
          <AppLinkTo to={R.amSetup}>{active.contract ? "Account Management connection" : "Connect Account Management →"}</AppLinkTo>
          <AppLinkTo to={R.reconcile}>Compare with Account Management →</AppLinkTo>
        </div>
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
        <h2 style={{ margin: 0, ...type.heading  }}>Commitment (optional)</h2>
        <span style={{ ...type.body, color: color.textSecondary }}>
          Used for the burn line: cost to date against your annual commitment, and an estimated run-out date.
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: space[16] }}>
          <Field id="c-amount" label="Annual commitment" unit={currency ?? undefined} value={amount} onChange={setAmount} check={(v) => checkNumber(v, AMOUNT_DECIMALS, "amount") ?? (v.trim() && Number(v) <= 0 ? "Enter a commitment above 0." : null)} />
          <Field id="c-start" label="Start date (UTC)" value={start} onChange={setStart} check={checkDate} placeholder="YYYY-MM-DD" />
          <Field id="c-end" label="End date (UTC)" value={end} onChange={setEnd} check={checkDate} placeholder="YYYY-MM-DD" />
        </div>
        {!fieldError && groupError && (
          <span role="alert" style={{ ...type.body, color: color.signal }}>
            {groupError}
          </span>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
        <h2 style={{ margin: 0, ...type.heading  }}>Rates in use, edits and yearly allowances</h2>
        <span style={{ ...type.body, color: color.textSecondary }}>
          Nothing here needs filling in. Edit a rate only to override it for one capability; it is then labelled
          "Edited". The allowance is optional: the yearly quantity you planned for that capability, used to show
          whether usage is on pace.
        </span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: space[16] }}>
          {billedCaps.map((c) => renderCard(c))}
        </div>
        {otherCaps.length > 0 && (
          <details className="lc-details" style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
            <summary style={{ ...type.heading, color: color.textSecondary, padding: `${space[8]}px 0` }}>
              {otherCaps.length} {otherCaps.length === 1 ? "capability" : "capabilities"} not billed in {period.phrase}
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: space[16], paddingTop: space[16] }}>
              {otherCaps.map((c) => renderCard(c))}
            </div>
          </details>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: space[16], flexWrap: "wrap" }}>
        <PrimaryButton onClick={canSave && !saving ? () => void onSave() : undefined}>
          {saving ? "Saving…" : "Save rate card"}
        </PrimaryButton>
        {!canSave && (
          <span style={{ ...type.body, color: color.textTertiary }}>
            {currency ? "Fix the fields marked above to save." : "Loading the rate source…"}
          </span>
        )}
        {saveError && (
          <span role="alert" style={{ ...type.body, color: color.signal }}>
            {saveError}
          </span>
        )}
      </div>
      <span style={{ ...type.body, color: color.textTertiary }}>
        Bytes are converted to GiB (1,073,741,824 bytes). Retain records are hourly snapshots of stored size, so they
        are priced per GiB-day. Metrics are priced per 100,000 data points. Workflows are priced per workflow-hour,
        because each billing record is one hour of one workflow.
      </span>
    </div>
  );
};
