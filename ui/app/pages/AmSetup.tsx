import React, { useEffect, useMemo, useState } from "react";
import { formatDay, formatDayRange, formatMoment } from "../locale";
import { TextInput, PasswordInput } from "@dynatrace/strato-components/forms";
import { showToast } from "@dynatrace/strato-components/notifications";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";

import { color, space, type, layout } from "../design/tokens";
import { Answer, Card, PrimaryButton, SecondaryButton } from "../design/primitives";
import { fixedWindow, Crumbs } from "../components/shared";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { funnelQuery, parseFunnelRows, summarise } from "../funnel";
import { closedDays, fetchCosts, fetchExtras, testConnection, type AmFailure, type AmSubscription } from "../data/accountManagement";
import { R } from "../routes";
import { allocationTotals, billedByDay, bookedLater, deriveContractRates } from "../data/contract";
import { PreviewTag } from "../components/Tags";
import { SOURCE_LABEL, formatCost, formatQuantity, useAmConnection, useAmSnapshot, useContractRates, type AmSnapshot, type ContractRates } from "../rates";

/**
 * 2026-10-08): what the admin creates, what to paste where, a Test connection
 * button, then "Calculate contract rates": Account Management cost divided by
 * the app's deduplicated billed usage over the last 30 closed UTC days.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAYS = 30;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: space[12], alignItems: "start" }}>
      <span
        aria-hidden="true"
        style={{ width: 28, height: 28, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", ...type.body, fontWeight: 500, background: color.textPrimary, color: color.bgBase }}
      >
        {n}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
        <span style={{ ...type.heading }}>{title}</span>
        <span style={{ ...type.body, color: color.textSecondary }}>{children}</span>
      </span>
    </li>
  );
}

function envId(): string | null {
  try {
    return getEnvironmentId();
  } catch {
    return null;
  }
}

export const AmSetup = () => {
  const conn = useAmConnection();
  const contract = useContractRates();
  const snapshot = useAmSnapshot();
  const [accountUuid, setAccountUuid] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<null | "test" | "calc" | "forget">(null);
  const [failure, setFailure] = useState<AmFailure | null>(null);
  const [subs, setSubs] = useState<AmSubscription[] | null>(null);
  const [chosenSub, setChosenSub] = useState<string | null>(null);
  const [calcNote, setCalcNote] = useState<string | null>(null);

  useEffect(() => {
    if (!conn.value) return;
    setAccountUuid(conn.value.accountUuid);
    setClientId(conn.value.clientId);
    setChosenSub(conn.value.subscriptionUuid);
  }, [conn.value]);

  // Billed usage over the same closed days, deduplicated, per capability.
  const window = useMemo(() => closedDays(DAYS), []);
  const usage = useMeasuredQuery((fields) => funnelQuery(fields), { window: fixedWindow(window.start, window.end) });
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const summaries = useMemo(
    () => summarise(usage.records ? parseFunnelRows(usage.records, usage.resolve) : []),
    [usage.records, usage.resolve],
  );

  const uuidOk = UUID.test(accountUuid.trim());
  // The secret field is blank after a reload: the stored secret is reused unless a new one is typed.
  const secret = clientSecret || conn.value?.clientSecret || "";
  const ready = uuidOk && clientId.trim() !== "" && secret !== "";
  const current = () => ({
    accountUuid: accountUuid.trim(),
    clientId: clientId.trim(),
    clientSecret: secret,
    subscriptionUuid: chosenSub,
  });

  async function onTest() {
    setBusy("test");
    setFailure(null);
    const res = await testConnection(current());
    setBusy(null);
    if (!res.ok) {
      setFailure(res);
      setSubs(null);
      return;
    }
    setSubs(res.subscriptions);
    const active = res.subscriptions.find((s) => s.status === "ACTIVE") ?? res.subscriptions[0];
    const sub = chosenSub ?? active?.uuid ?? null;
    setChosenSub(sub);
    setSavedNote(null);
    showToast({ type: "success", title: "Connected to Account Management", message: `${res.subscriptions.length} subscription(s) found. Save to keep the connection.` });
  }

  const saveFailed = (what: string, e: unknown) =>
    showToast({ type: "critical", title: `${what} wasn't saved`, message: e instanceof Error ? e.message : "Your settings could not be written. Try again." });

  async function onSave() {
    try {
      await conn.save(current());
      setSavedNote("Connection saved to your user settings, including the client secret. It is used only by this app's connection function.");
      showToast({ type: "success", title: "Connection saved", message: "Stored for your user only." });
    } catch (e) {
      saveFailed("The connection", e);
    }
  }

  async function onForget() {
    setBusy("forget");
    try {
      await Promise.all([conn.save(null), contract.save(null), snapshot.save(null)]);
      setSubs(null);
      setClientSecret("");
      setSavedNote(null);
      showToast({ type: "success", title: "Connection forgotten", message: "List prices apply again." });
    } catch (e) {
      saveFailed("The change", e);
    } finally {
      setBusy(null);
    }
  }

  async function onCalculate() {
    setFailure(null);
    setCalcNote(null);
    const env = envId();
    // Rates are cost divided by usage: incomplete usage, or cost for every environment
    // divided by this one's usage, would make every rate too high.
    if (usage.partial) {
      setCalcNote("No contract rates were saved: this environment's usage for those days came back incomplete (too many records), so the rates would be too high. Try again later.");
      return;
    }
    if (!env) {
      setCalcNote("No contract rates were saved: the app couldn't read this environment's ID, so Account Management's cost can't be matched to this environment's usage.");
      return;
    }
    setBusy("calc");
    let res: Awaited<ReturnType<typeof fetchCosts>>;
    try {
      res = await fetchCosts(current(), window.start, window.end, [env]);
    } finally {
      setBusy(null);
    }
    if (!res.ok) {
      setFailure(res);
      return;
    }
    // Account Management had more pages than the app reads: the cost is incomplete, so the rates would be too low.
    if (!res.complete) {
      setCalcNote("No contract rates were saved: Account Management returned more cost lines than this app reads at once, so the totals would be too low.");
      return;
    }
    // Only this environment's cost, even if Account Management answered for more.
    const costs = res.costs.filter((c) => !c.environmentId || c.environmentId === env);
    const { currency, rates, unmatched, unmatchedCost, total, mixed } = deriveContractRates(costs, summaries);
    // Never save a result that would leave the app with fewer prices than before.
    if (!currency || Object.keys(rates).length === 0 || mixed) {
      setCalcNote(
        !currency || Object.keys(rates).length === 0
          ? "No contract rates were saved: Account Management returned no cost that matches this environment's billed usage for these days. Check the environment ID, or try again after the next billing day."
          : "No contract rates were saved: Account Management returned cost in more than one currency, so one rate per capability can't be worked out.",
      );
      return;
    }
    const next: ContractRates = {
      currency,
      rates,
      periodStart: window.start,
      periodEnd: window.end,
      computedAt: new Date().toISOString(),
      subscriptionName: res.subscription.name ?? res.subscription.uuid,
      billed: { total, unmatched: unmatchedCost, byDay: billedByDay(costs, currency), bookedLater: bookedLater(costs, currency) },
    };
    try {
      await contract.save(next);
    } catch (e) {
      saveFailed("The contract rates", e);
      return;
    }
    setCalcNote(
      `${Object.keys(rates).length} contract rates calculated in ${currency || "the contract currency"}.` +
        (unmatched.length
          ? currency === "USD"
            ? ` No matching billed usage for: ${unmatched.join(", ")}; those keep their list price.`
            : ` No matching billed usage for: ${unmatched.join(", ")}. List prices are in USD, so those have no price in ${currency} until you add one on the Rate card.`
          : ""),
    );
    showToast({ type: "success", title: "Contract rates calculated", message: `${Object.keys(rates).length} rates.` });
    await saveSnapshot(env);
  }

  /** Budget, forecast, alerts, the cost-centre split and every environment's cost: read once, saved with the rates. */
  async function saveSnapshot(env: string | null) {
    setBusy("calc");
    let x: Awaited<ReturnType<typeof fetchExtras>>;
    try {
      x = await fetchExtras(current(), window.start, window.end, env);
    } finally {
      setBusy(null);
    }
    if (!x.ok) return;
    const missing = (
      [
        ["Budget and period", x.subscription],
        ["Forecast", x.forecast],
        ["Cost alerts", x.alerts],
        ["Cost-centre split", x.allocation],
        ["Cost for every environment", x.accountCost],
      ] as const
    ).flatMap(([part, r]) => (r.ok ? [] : [{ part, message: r.message }]));
    const next: AmSnapshot = {
      computedAt: new Date().toISOString(),
      periodStart: window.start,
      periodEnd: window.end,
      budget: x.subscription.ok ? x.subscription.budget : null,
      period: x.subscription.ok ? x.subscription.period : null,
      forecast: x.forecast.ok && x.forecast.median !== null ? x.forecast : null,
      alerts: x.alerts.ok ? x.alerts.items.slice(0, 20) : [],
      allocation: x.allocation.ok ? allocationTotals(x.allocation.items) : null,
      allocationComplete: x.allocation.ok && x.allocation.complete,
      accountByDay: x.accountCost.ok ? x.accountCost.byDay : null,
      accountCurrency: x.accountCost.ok ? x.accountCost.currency : "",
      missing,
    };
    try {
      await snapshot.save(next);
    } catch (e) {
      saveFailed("The Account Management figures", e);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32], maxWidth: layout.content }}>
      <Crumbs trail={[{ label: "Rate card", to: R.rates }, { label: "Connect Account Management" }]} />
      <Answer
        setup="Use your contract rates"
        conclusion="instead of list prices."
        lead="A one-time setup by an Account Management admin. The app then divides your Account Management cost by your billed usage, and every figure says 'Your contract rate (calculated)'. It only reads usage and cost; it changes nothing in Dynatrace."
      />
      <PreviewTag />

      <Card>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: space[24] }}>
          <Step n={1} title="Find your account ID">
            In Account Management, open Identity & access management &gt; OAuth clients. The account UUID is shown on
            that page. Paste it below.
          </Step>
          <Step n={2} title="Create an OAuth client">
            On the same page, choose Create client. Give it a service user email, for example
            licence-app@yourcompany.com. Under Permissions &gt; Account, select only &quot;View usage and
            consumption&quot; (account-uac-read). Create it, then copy the client ID and the client secret. The secret
            is shown once.
          </Step>
          <Step n={3} title="Allow the connection, if your environment limits it">
            If outbound connections from Dynatrace apps are limited in this environment, an environment admin must
            allow sso.dynatrace.com and api.dynatrace.com. If they are not limited, skip this step.
          </Step>
          <Step n={4} title="Paste the three values and test">
            Test connection checks the three values and lists your subscriptions; nothing is stored until you choose
            Save connection. Saved values live in your user settings only, including the secret, and are used only by
            this app&apos;s connection function. The secret is never shown again.
          </Step>
        </ol>
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
        <label style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          <span style={{ ...type.body, color: color.textSecondary }}>Account UUID</span>
          <TextInput value={accountUuid} onChange={setAccountUuid} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          {accountUuid.trim() !== "" && !uuidOk && (
            <span role="alert" style={{ ...type.body, color: color.signal }}>
              Enter the account UUID as shown in Account Management: 36 characters with dashes.
            </span>
          )}
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          <span style={{ ...type.body, color: color.textSecondary }}>Client ID</span>
          <TextInput value={clientId} onChange={setClientId} placeholder="dt0s02.XXXXXXXX" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
          <span style={{ ...type.body, color: color.textSecondary }}>Client secret</span>
          <PasswordInput
            value={clientSecret}
            onChange={setClientSecret}
            placeholder={conn.value ? "Stored. Type a new one to replace it." : "dt0s02.XXXXXXXX.XXXX…"}
          />
        </label>
        <div style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
          <SecondaryButton onClick={ready && !busy ? () => void onTest() : undefined}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </SecondaryButton>
          {!ready && <span style={{ ...type.body, color: color.textTertiary }}>Fill in all three to test.</span>}
          {subs && (
            <SecondaryButton onClick={!busy ? () => void onSave() : undefined}>Save connection</SecondaryButton>
          )}
          {conn.value && (
            <SecondaryButton onClick={!busy ? () => void onForget() : undefined}>
              {busy === "forget" ? "Forgetting…" : "Forget this connection"}
            </SecondaryButton>
          )}
        </div>
        {savedNote && <span role="status" style={{ ...type.body, color: color.textSecondary }}>{savedNote}</span>}
        {failure && (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            <span style={{ ...type.heading }}>The connection didn&apos;t work at the {failure.step} step.</span>
            <span style={{ ...type.body, color: color.textSecondary }}>{failure.message}</span>
          </div>
        )}
        {subs && (
          <div role="status" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            <span style={{ ...type.heading }}>
              Connected. {subs.length} {subs.length === 1 ? "subscription" : "subscriptions"} found.
            </span>
            {subs.map((s) => (
              <label key={s.uuid} style={{ display: "flex", gap: space[8], alignItems: "center", ...type.body }}>
                <input type="radio" name="sub" checked={chosenSub === s.uuid} onChange={() => setChosenSub(s.uuid)} />
                {s.name}, {s.status}
                {s.startTime ? `, ${formatDay(s.startTime)} to ${s.endTime ? formatDay(s.endTime) : "open"}` : ""}
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
        <span style={{ ...type.heading }}>Contract rates</span>
        <span style={{ ...type.body, color: color.textSecondary }}>
          Rate per capability = Account Management cost ÷ billed usage in this environment, over the last {DAYS} closed
          UTC days ({formatDayRange(window.start, window.end)}). Capabilities without cost keep their
          list price.
        </span>
        <div>
          <PrimaryButton onClick={conn.value && !busy && usage.records ? () => void onCalculate() : undefined}>
            {busy === "calc" ? "Calculating…" : "Calculate contract rates"}
          </PrimaryButton>
        </div>
        {!conn.value && <span style={{ ...type.body, color: color.textTertiary }}>Test and save the connection first.</span>}
        {calcNote && <span role="status" style={{ ...type.body }}>{calcNote}</span>}
        {contract.value && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            <span style={{ ...type.body, color: color.textTertiary }}>
              {SOURCE_LABEL.contract}, calculated {formatMoment(new Date(contract.value.computedAt))} for{" "}
              {formatDayRange(contract.value.periodStart, contract.value.periodEnd)}:
            </span>
            {Object.entries(contract.value.rates).map(([k, v]) => (
              <span key={k} style={{ ...type.body }}>
                {k}: {formatCost(v, contract.value?.currency || "USD").replace(/\.?0+$/, "")} ({formatQuantity(v)} per unit)
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
