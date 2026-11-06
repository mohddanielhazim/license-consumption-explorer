import React, { useEffect, useMemo, useState } from "react";
import { appLocale } from "../locale";
import { R } from "../routes";
import { TextInput } from "@dynatrace/strato-components/forms";
import { showToast } from "@dynatrace/strato-components/notifications";

import { color, radius, space, type, size } from "../design/tokens";
import { Answer, Card, Label, PrimaryButton, SecondaryButton, SignalLabel, Dropdown } from "../design/primitives";
import { Info } from "../components/Info";
import { EntityIdLine, disambiguate, displayName, nameState } from "../components/EntityName";
import { useWarnUnsaved, Bone, DataAsOf, ENTITY_RESULT_RECORDS, QueryOutcome, ShowQuery, useBillingQuery, usePeriod } from "../components/shared";
import { useDiscovery } from "../components/useMeasuredQuery";
import { COST_CENTRE_FIELDS, compactQuantity } from "../funnel";
import { usePref, type PrefSpec } from "../data/prefs";
import {
  RULE_LABEL,
  RULE_NEEDS_KEY,
  costCentreOwner,
  hostOwner,
  keySplit,
  namespaceOwner,
  useOwnerRules,
  type Owner,
  type OwnerRule,
  type RuleSource,
} from "../data/ownership";
import { PriceTag } from "../components/Tags";
import { PagerFooter, usePager } from "../components/RankedList";
import { CsvDownload, type CsvColumn } from "../components/CsvDownload";
import { formatCost, sourcesLabel, useRates, type RateSource, type Rates } from "../rates";

import { NextSteps } from "../components/NextSteps";
import { useClassicEntitiesMissing } from "../data/entities";
import { MSG, NAME } from "../strings";
/**
 * Ownership: who owns each billed host and namespace,
 * from a Dynatrace cost centre on its billing records or from the user's own
 * rules over tags, host groups, management zones and Kubernetes labels or
 * annotations (app rules, labelled as not Dynatrace Cost Allocation). Then a
 * rollup per owner with per-team budgets (Dynatrace budgets are environment-wide).
 * Host records and namespace records do not overlap on billing events, so no
 * usage is counted twice; the namespace query excludes records naming a host.
 */
const hostsQuery = (qty: string) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| fieldsAdd host_id = coalesce(toString(dt.smartscape.host), dt.entity.host)
| filter isNotNull(host_id)
| fieldsAdd qty = ${qty}
| summarize {qty = sum(qty), n_qty = countIf(isNotNull(qty)), cost_centres = collectDistinct(cost_centre), last_record = max(timestamp)},
    by:{host_id, event.type}
| lookup [fetch dt.entity.host | fields id, entity.name, hostGroupName, tags, managementZones], sourceField: host_id, lookupField: id, prefix: "host."`;

const namespacesQuery = (qty: string) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| filter isNull(dt.entity.host) and isNull(dt.smartscape.host)
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| fieldsAdd ns_id = coalesce(dt.entity.cloud_application_namespace, toString(dt.smartscape.k8s_namespace))
| filter isNotNull(ns_id)
| fieldsAdd qty = ${qty}
| summarize {qty = sum(qty), n_qty = countIf(isNotNull(qty)), cost_centres = collectDistinct(cost_centre), last_record = max(timestamp)},
    by:{ns_id, event.type}
| lookup [fetch dt.entity.cloud_application_namespace | fields id, entity.name, namespaceName, cloudApplicationLabels, kubernetesAnnotations, managementZones],
    sourceField: ns_id, lookupField: id, prefix: "ns."`;

type Budgets = { currency: string; per30Days: Record<string, number> };
export const BUDGETS: PrefSpec<Budgets | null> = {
  key: "team-budgets",
  version: 1,
  defaults: null,
  validate: (v) =>
    typeof v === "object" && v !== null && typeof (v as Budgets).currency === "string" && typeof (v as Budgets).per30Days === "object"
      ? (v as Budgets)
      : null,
};

type Ent = {
  kind: "host" | "namespace";
  id: string;
  name: string;
  owner: Owner | null;
  cost: number | null;
  unpriced: boolean;
  facts: { tags: unknown; hostGroup: string | null; zones: unknown; labels: unknown; annotations: unknown; nsName: string | null; costCentres: unknown[] };
  /** Capabilities billed to it in the period (units screen: what, not how much money). */
  caps: string[];
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString(appLocale())} ${n === 1 ? one : many}`;

function collect(
  records: ReadonlyArray<Record<string, unknown> | null> | undefined,
  kind: "host" | "namespace",
  resolve: ReturnType<typeof useDiscovery>["resolve"],
  rates: Rates,
  sources: Set<RateSource>,
) {
  const byId = new Map<string, Ent>();
  let last: string | null = null;
  const idKey = kind === "host" ? "host_id" : "ns_id";
  const p = kind === "host" ? "host." : "ns.";
  for (const r of records ?? []) {
    if (!r || typeof r[idKey] !== "string") continue;
    const id = r[idKey];
    const e: Ent = byId.get(id) ?? {
      kind,
      id,
      name: displayName(str(r[`${p}entity.name`]), kind, nameState(r[`${p}id`], r[`${p}entity.name`])),
      owner: null,
      cost: 0,
      unpriced: false,
      facts: {
        tags: r["host.tags"],
        hostGroup: str(r["host.hostGroupName"]),
        zones: r[`${p}managementZones`],
        labels: r["ns.cloudApplicationLabels"],
        annotations: r["ns.kubernetesAnnotations"],
        nsName: str(r["ns.namespaceName"]) ?? str(r["ns.entity.name"]),
        costCentres: [],
      },
      caps: [],
    };
    if (Array.isArray(r.cost_centres)) e.facts.costCentres.push(...(r.cost_centres as unknown[]));
    const eventType = String(r["event.type"]);
    const cap = resolve(eventType);
    const q = compactQuantity(r);
    if (q !== null && q > 0) {
      if (!e.caps.includes(eventType)) e.caps.push(eventType);
      const rate = rates.rateFor(eventType);
      if (rate) {
        sources.add(rate.source);
        e.cost = (e.cost ?? 0) + cap.toRateUnits(q) * rate.value;
      } else e.unpriced = true;
    }
    byId.set(id, e);
    if (typeof r.last_record === "string" && (!last || r.last_record > last)) last = r.last_record;
  }
  return { list: [...byId.values()], last };
}

/**
 * The ownership data: both queries, owner per entity, rollup per owner. Moved
 * out of the page unchanged in v0.10.0 so the Cost workspace's Team budgets
 * screen shares it. `rules` is the draft on the Ownership screen and the
 * saved rules on Team budgets.
 */
export function useOwnershipData(rules: OwnerRule[]) {
  const rates = useRates();
  const { discovery, resolve, qty } = useDiscovery();
  const ready = discovery.records !== undefined && discovery.records.length > 0;
  const hosts = useBillingQuery(hostsQuery(qty), { enabled: ready, maxRecords: ENTITY_RESULT_RECORDS });
  const namespaces = useBillingQuery(namespacesQuery(qty), { enabled: ready, maxRecords: ENTITY_RESULT_RECORDS });

  const { ents, last, sources } = useMemo(() => {
    const src = new Set<RateSource>();
    const h = collect(hosts.records, "host", resolve, rates, src);
    const n = collect(namespaces.records, "namespace", resolve, rates, src);
    for (const e of h.list)
      e.owner = costCentreOwner(e.facts.costCentres) ?? hostOwner({ tags: e.facts.tags, hostGroup: e.facts.hostGroup, managementZones: e.facts.zones }, rules);
    for (const e of n.list)
      e.owner =
        costCentreOwner(e.facts.costCentres) ??
        namespaceOwner({ name: e.facts.nsName, labels: e.facts.labels, annotations: e.facts.annotations, managementZones: e.facts.zones }, rules);
    return { ents: [...h.list, ...n.list], last: [h.last, n.last].filter(Boolean).sort().pop() ?? null, sources: src };
  }, [hosts.records, namespaces.records, resolve, rates, rules]);

  const owned = ents.filter((e) => e.owner);
  const teams = useMemo(() => {
    const m = new Map<string, { name: string; via: Set<string>; kind: Set<Owner["kind"]>; hosts: number; namespaces: number; cost: number }>();
    for (const e of owned) {
      const o = e.owner as Owner;
      const t = m.get(o.name) ?? { name: o.name, via: new Set<string>(), kind: new Set<Owner["kind"]>(), hosts: 0, namespaces: 0, cost: 0 };
      t.via.add(o.via);
      t.kind.add(o.kind);
      if (e.kind === "host") t.hosts += 1;
      else t.namespaces += 1;
      t.cost += e.cost ?? 0;
      m.set(o.name, t);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
  }, [owned]);

  const loading = discovery.isLoading || hosts.isLoading || namespaces.isLoading || rates.isLoading;
  const failing = discovery.error ? discovery : hosts.error ? hosts : namespaces;
  return { rates, discovery, hosts, namespaces, ents, owned, teams, last, sources, loading, failing };
}

/** One field style for the rule sentence: 40 px, the input border. */
const ruleField: React.CSSProperties = {
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

export const Ownership = () => {
  const noClassic = useClassicEntitiesMissing();
  const { value: savedRules, save: saveRules, isLoading: rulesLoading, readFailed: rulesReadFailed } = useOwnerRules();
  const period = usePeriod();

  // The editor works on a draft; owners on this page follow the draft so the
  // effect of a rule is visible before saving.
  const [draft, setDraft] = useState<OwnerRule[]>([]);
  useEffect(() => setDraft(savedRules), [savedRules]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedRules);
  useWarnUnsaved(dirty && !rulesLoading);

  const { discovery, hosts, namespaces, ents, owned, last, loading, failing } = useOwnershipData(draft);
  const hostsN = ents.filter((e) => e.kind === "host");
  const nsN = ents.filter((e) => e.kind === "namespace");

  // Keys seen on the billed entities, offered as suggestions in the editor.
  const suggestions = useMemo(() => {
    const tagKeys = new Set<string>();
    const labelKeys = new Set<string>();
    const annotationKeys = new Set<string>();
    for (const e of ents) {
      if (Array.isArray(e.facts.tags))
        for (const t of e.facts.tags as unknown[]) {
          if (typeof t !== "string") continue;
          const plain = t.replace(/^\[[^\]]*\]/, "");
          const i = keySplit(plain);
          if (i > 0) tagKeys.add(plain.slice(0, i).replace(/\\:/g, ":"));
        }
      if (e.facts.labels && typeof e.facts.labels === "object") Object.keys(e.facts.labels).forEach((k) => labelKeys.add(k));
      if (e.facts.annotations && typeof e.facts.annotations === "object") Object.keys(e.facts.annotations).forEach((k) => annotationKeys.add(k));
    }
    return { hostTag: [...tagKeys].sort(), namespaceLabel: [...labelKeys].sort(), namespaceAnnotation: [...annotationKeys].sort() };
  }, [ents]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[48] }}>
      <QueryOutcome
        query={failing.query}
        records={discovery.error || hosts.error || namespaces.error ? undefined : loading ? undefined : [...(hosts.records ?? []), ...(namespaces.records ?? [])]}
        error={discovery.error ?? hosts.error ?? namespaces.error}
        errorKind={hosts.errorKind ?? namespaces.errorKind}
        isLoading={loading}
        retry={failing.retry} cancel={failing.cancel} cancelled={failing.cancelled}
        empty={`No billing records named a host or a namespace in ${period.phrase}.`}
        skeleton={<OwnershipSkeleton />}
      >
        <Answer
          setup={`${owned.length} of ${plural(ents.length, "billed host or namespace", "billed hosts and namespaces")}`}
          conclusion={owned.length === 1 ? "has an owner." : "have an owner."}
          lead={
            `Hosts: ${hostsN.filter((e) => e.owner).length} of ${hostsN.length}. Namespaces: ${nsN.filter((e) => e.owner).length} of ${nsN.length}.` +

            " An owner comes from a Dynatrace cost centre on the billing records, or from your rules below (app rules, not Dynatrace Cost Allocation)."
          }
        />
        <DataAsOf last={last} />
      </QueryOutcome>

      {rulesReadFailed && (
        <Card role="alert">
          <span style={{ ...type.body, color: color.textSecondary }}>
            Your saved ownership rules couldn't be read, so they aren't shown and saving is paused to keep them safe. Reload the app to try again.
          </span>
        </Card>
      )}
      {noClassic && (
        <Card>
          <span style={{ ...type.body, color: color.textSecondary }}>{MSG.noClassicRules}</span>
        </Card>
      )}
      <RulesEditor
        draft={draft}
        setDraft={setDraft}
        dirty={dirty}
        loading={rulesLoading}
        suggestions={suggestions}
        onSave={async () => {
          try {
            await saveRules(draft);
            showToast({ type: "success", title: "Ownership rules saved", message: `${plural(draft.length, "rule", "rules")}, stored for your user.` });
          } catch (e) {
            showToast({ type: "critical", title: "The rules weren't saved", message: e instanceof Error ? e.message : String(e) });
          }
        }}
        onReset={() => setDraft(savedRules)}
      />

      {/* Lists and the download only when both queries answered: half a list sent to teams is worse than none. */}
      {!loading && !(discovery.error || hosts.error || namespaces.error) && ents.length > 0 && (
        <>
          <Unowned ents={ents.filter((e) => !e.owner)} />
          <EveryEntityCsv ents={ents} />
        </>
      )}
      <NextSteps links={[{ to: R.budgets, label: "Set a budget per owner" }, { to: R.fixes, label: "See what else is worth reviewing" }]} />
      <ShowQuery query={`${hosts.query}\n\n${namespaces.query}`} />
    </div>
  );
};

const SOURCES = Object.keys(RULE_LABEL) as RuleSource[];

function RulesEditor({
  draft,
  setDraft,
  dirty,
  loading,
  suggestions,
  onSave,
  onReset,
}: {
  draft: OwnerRule[];
  setDraft: (r: OwnerRule[]) => void;
  dirty: boolean;
  loading: boolean;
  suggestions: Partial<Record<RuleSource, string[]>>;
  onSave: () => Promise<void>;
  onReset: () => void;
}) {
  const [source, setSource] = useState<RuleSource>("hostTag");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const needsKey = RULE_NEEDS_KEY[source];
  const keyOk = !needsKey || /^[\w.\-/:]{1,100}$/.test(key.trim());
  const move = (i: number, d: -1 | 1) => {
    const next = [...draft];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  return (
    <section aria-label="Ownership rules" style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
      <span style={{ display: "flex", alignItems: "center", gap: space[8] }}>
        <h2 style={{ margin: 0, ...type.title }}>Ownership rules</h2>
        <Info
          label="Ownership rules"
          guide={{
            what: "Rules that read an owner from your own metadata: a host tag, host group, management zone, namespace label, annotation or name.",
            why: "Dynatrace Cost Allocation applies from the time a cost centre is set. Rules also cover past periods, using metadata you already have.",
            how: "For each host or namespace, rules are tried top to bottom and the first that yields a value names the owner. A real Dynatrace cost centre always wins over a rule.",
            where: "Stored for your user only. They change nothing in Dynatrace.",
            who: "Whoever reports cost per team.",
          }}
        />
      </span>
      {/* With saved rules and nothing unsaved, the editor folds to one line: the screen leads with who owns what. */}
      <details className="lc-details" open={draft.length === 0 || dirty} style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
        <summary style={{ ...type.body, color: color.textSecondary, padding: `${space[8]}px 0` }}>
          {draft.length === 0
            ? "Add a rule"
            : `${draft.length} ${draft.length === 1 ? "rule" : "rules"}: ${draft.map((r) => `${RULE_LABEL[r.source]}${r.key ? ` ${r.key}` : ""}`).join(", ")}`}
        </summary>
      <Card style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
        {loading ? (
          <Bone w="60%" h={20} />
        ) : draft.length === 0 ? (
          <span style={{ ...type.body, color: color.textSecondary }}>No rules yet. Only Dynatrace cost centres name owners.</span>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
            {draft.map((r, i) => (
              <li key={r.id} style={{ display: "flex", alignItems: "center", gap: space[12], padding: `${space[8]}px 0`, borderTop: i ? `1px solid ${color.line}` : "none", flexWrap: "wrap" }}>
                <span style={{ ...type.body, color: color.textTertiary, width: 24 }}>{i + 1}.</span>
                <span style={{ ...type.body, flex: "1 1 240px" }}>
                  {RULE_LABEL[r.source]}
                  {r.key ? <span style={{ ...type.mono, color: color.textSecondary }}> {r.key}</span> : null}
                </span>
                <SecondaryButton onClick={i > 0 ? () => move(i, -1) : undefined} aria-label={`Move rule ${i + 1} up`}>
                  Up
                </SecondaryButton>
                <SecondaryButton onClick={i < draft.length - 1 ? () => move(i, 1) : undefined} aria-label={`Move rule ${i + 1} down`}>
                  Down
                </SecondaryButton>
                <SecondaryButton onClick={() => setDraft(draft.filter((x) => x.id !== r.id))} aria-label={`Remove rule ${i + 1}`}>
                  Remove
                </SecondaryButton>
              </li>
            ))}
          </ol>
        )}
        {/* One sentence of controls (v0.12.13): labels inline, every field 40 px. */}
        <div style={{ display: "flex", gap: space[8], alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${color.line}`, paddingTop: space[16], ...type.bodyLarge }}>
          <label htmlFor="rule-source" style={{ color: color.textSecondary }}>The owner is the</label>
          <Dropdown id="rule-source" value={source} onChange={(v) => setSource(v as RuleSource)} options={SOURCES.map((x) => ({ value: x, label: RULE_LABEL[x].toLowerCase() }))} />
          {needsKey && (
            <>
              <label htmlFor="rule-key" style={{ color: color.textSecondary }}>named</label>
              <input id="rule-key" className="lc-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder={source === "hostTag" ? "team" : "app.kubernetes.io/part-of"} style={{ ...ruleField, width: 220 }} />
            </>
          )}
          <SecondaryButton
            onClick={
              keyOk && (!needsKey || key.trim())
                ? () => {
                    setDraft([...draft, { id: `${Date.now()}`, source, key: needsKey ? key.trim() : undefined }]);
                    setKey("");
                  }
                : undefined
            }
          >
            Add rule
          </SecondaryButton>
        </div>
        {needsKey && key.trim() !== "" && !keyOk && (
          <span role="alert" style={{ ...type.body, color: color.signal }}>
            Use letters, digits and . - _ / : only, up to 100 characters.
          </span>
        )}
        {needsKey && (suggestions[source]?.length ?? 0) > 0 && (
          <span style={{ display: "flex", gap: space[8], flexWrap: "wrap", alignItems: "center", ...type.body, color: color.textTertiary }}>
            Keys on your billed {source === "hostTag" ? "hosts" : "namespaces"} (select one to use it):
            {suggestions[source]?.slice(0, 12).map((k) => (
              <button
                key={k}
                type="button"
                className="lc-btn"
                onClick={() => setKey(k)}
                style={{ ...type.mono, height: 28, padding: `0 ${space[8]}px`, borderRadius: radius.chip, border: 0, background: color.surface2, color: color.textPrimary }}
              >
                {k}
              </button>
            ))}
          </span>
        )}
        <div style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
          <PrimaryButton
            onClick={
              dirty && !saving
                ? () => {
                    setSaving(true);
                    void onSave().finally(() => setSaving(false));
                  }
                : undefined
            }
          >
            {saving ? "Saving…" : "Save rules"}
          </PrimaryButton>
          {dirty && <SecondaryButton onClick={onReset}>Discard changes</SecondaryButton>}
          <span style={{ ...type.body, color: color.textTertiary }}>
            {dirty ? "Owners on this page already follow the unsaved rules." : "No unsaved changes. Rules are kept for your user only."}
          </span>
        </div>
      </Card>
      </details>
    </section>
  );
}

type Team = { name: string; via: Set<string>; kind: Set<Owner["kind"]>; hosts: number; namespaces: number; cost: number };

export function Teams({ teams, rates, days, budgets, sources }: { teams: Team[]; rates: Rates; days: number; budgets: ReturnType<typeof usePref<Budgets | null>>; sources?: Set<RateSource> }) {
  const stored = budgets.value;
  const usable = stored && stored.currency === rates.currency ? stored.per30Days : {};
  const [edit, setEdit] = useState<Record<string, string>>({});
  useEffect(() => setEdit(Object.fromEntries(Object.entries(usable).map(([k, v]) => [k, String(v)]))), [stored, rates.currency]); // eslint-disable-line react-hooks/exhaustive-deps
  const invalid = Object.entries(edit).filter(([, v]) => v.trim() !== "" && !(Number(v) >= 0));
  const dirty = JSON.stringify(Object.fromEntries(Object.entries(edit).filter(([, v]) => v.trim() !== ""))) !== JSON.stringify(Object.fromEntries(Object.entries(usable).map(([k, v]) => [k, String(v)])));
  useWarnUnsaved(dirty);
  return (
    <section aria-label="Owners" style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
      <span style={{ display: "flex", alignItems: "center", gap: space[8] }}>
        <h2 style={{ margin: 0, ...type.title }}>Owners and budgets</h2>
        <Info
          label="Owners and budgets"
          guide={{
            what: "Cost per owner in the timeframe, against an optional budget per 30 days that you set here.",
            why: "Dynatrace budgets are environment-wide only; this splits the spend per team.",
            how: "Budget for the period = budget per 30 days × days in the timeframe ÷ 30. Within: under 90%. Close: 90 to 100%. Over: above 100%.",
            where: "Budgets are stored for your user, in the currency of the rates in use.",
          }}
        />
      </span>
      {budgets.readFailed && (
        <span role="alert" style={{ ...type.body, color: color.textSecondary }}>
          Your saved budgets couldn't be read, so saving is paused to keep them safe. Reload the app to try again.
        </span>
      )}
      {stored && stored.currency !== rates.currency && (
        <span style={{ ...type.body, color: color.textTertiary }}>
          Budgets saved in {stored.currency} are not applied: the rates in use are in {rates.currency}.
          {Object.keys(stored.per30Days).length > 0 ? ` Saving budgets now replaces the ${Object.keys(stored.per30Days).length} saved in ${stored.currency}.` : ""}
        </span>
      )}
      {teams.length === 0 ? (
        <Card>
          <span style={{ ...type.body, color: color.textSecondary }}>Nothing has an owner yet. Add an ownership rule on the Ownership screen, or set cost centres in Dynatrace Cost Allocation.</span>
        </Card>
      ) : (
        <div role="table" aria-label="Owners" style={{ display: "flex", flexDirection: "column", overflowX: "auto" }}>
          <div role="row" style={{ ...teamGrid, padding: `0 ${space[8]}px ${space[8]}px` }}>
            {["Owner", "Owns", `Cost`, `Budget per 30 days (${rates.currency})`, "Against budget"].map((h, i) => (
              <span key={h} role="columnheader" style={{ ...type.label, color: color.textTertiary, textAlign: i >= 2 && i !== 3 ? "right" : "left" }}>
                {h}
                {i === 2 && sources && sources.size > 0 ? (
                  <span style={{ display: "block", paddingTop: space[4] }}>
                    <PriceTag sources={sources} />
                  </span>
                ) : null}
              </span>
            ))}
          </div>
          {teams.map((t) => {
            const raw = edit[t.name] ?? "";
            const budget = raw.trim() !== "" && Number(raw) >= 0 ? (Number(raw) * days) / 30 : null;
            const share = budget && budget > 0 ? t.cost / budget : null;
            const state = share === null ? null : share > 1 ? "Over budget" : share >= 0.9 ? "Close to budget" : "Within budget";
            return (
              <div key={t.name} role="row" style={{ ...teamGrid, padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}` }}>
                <span role="cell" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
                  <span style={{ ...type.heading, overflowWrap: "anywhere" }}>{t.name}</span>
                  <span style={{ ...type.body, color: color.textTertiary }}>
                    {[...t.via].join(", ")}
                    {t.kind.has("rule") ? " (app rule, not Dynatrace Cost Allocation)" : ""}
                  </span>
                </span>
                <span role="cell" style={{ ...type.body, color: color.textSecondary }}>
                  {[t.hosts ? plural(t.hosts, "host", "hosts") : null, t.namespaces ? plural(t.namespaces, "namespace", "namespaces") : null].filter(Boolean).join(", ")}
                </span>
                <span role="cell" style={{ ...type.body, textAlign: "right" }}>{formatCost(t.cost, rates.currency)}</span>
                <span role="cell">
                  <TextInput value={raw} onChange={(v) => setEdit({ ...edit, [t.name]: v })} placeholder="Optional" aria-label={`Budget per 30 days for ${t.name}`} />
                </span>
                <span role="cell" style={{ textAlign: "right" }}>
                  {state === null ? (
                    <span style={{ ...type.body, color: color.textTertiary }}>No budget</span>
                  ) : state === "Over budget" ? (
                    <SignalLabel>{`${state}: ${Math.round((share ?? 0) * 100)}%`}</SignalLabel>
                  ) : (
                    <Label>{`${state}: ${Math.round((share ?? 0) * 100)}%`}</Label>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {invalid.length > 0 && (
        <span role="alert" style={{ ...type.body, color: color.signal }}>
          Enter budgets as amounts of 0 or more.
        </span>
      )}
      {teams.length > 0 && (
        <div style={{ display: "flex", gap: space[12], alignItems: "center" }}>
          <PrimaryButton
            onClick={
              dirty && invalid.length === 0
                ? () => {
                    const per30Days = Object.fromEntries(Object.entries(edit).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)]));
                    void budgets
                      .save({ currency: rates.currency, per30Days })
                      .then(() => showToast({ type: "success", title: "Budgets saved", message: `${Object.keys(per30Days).length} budgets in ${rates.currency}.` }))
                      .catch((e: unknown) => showToast({ type: "critical", title: "The budgets weren't saved", message: e instanceof Error ? e.message : String(e) }));
                  }
                : undefined
            }
          >
            Save budgets
          </PrimaryButton>
        </div>
      )}
      <CsvDownload filtered={false}
        name="team-budgets"
        noun="owners"
        rows={teams}
        columns={[
          { header: "Owner", value: (t) => t.name },
          { header: "Owner from", value: (t) => [...t.via].join("; ") },
          { header: "Hosts", value: (t) => t.hosts },
          { header: "Namespaces", value: (t) => t.namespaces },
          { header: `Cost (${(sources && sourcesLabel(sources)) || "rate"}, ${rates.currency})`, value: (t) => t.cost },
          { header: `Budget for the period (${rates.currency})`, value: (t) => { const raw = edit[t.name] ?? ""; return raw.trim() !== "" && Number(raw) >= 0 ? (Number(raw) * days) / 30 : null; } },
        ]}
      />
    </section>
  );
}

/** Units screen: what each unowned host or namespace is billed for, not how much; the money is on Team budgets. */
function Unowned({ ents }: { ents: Ent[] }) {
  const rows = disambiguate(
    [...ents].sort((a, b) => b.caps.length - a.caps.length || a.name.localeCompare(b.name)).map((e) => ({ ...e, entityId: e.id, disambiguator: e.facts.hostGroup ?? undefined })),
  );
  const pager = usePager(rows.length);
  return (
    <section aria-label={NAME.noOwnerYet} style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <h2 style={{ margin: 0, ...type.title }}>No owner yet</h2>
      {rows.length === 0 ? (
        <span style={{ ...type.body, color: color.textSecondary }}>Every billed host and namespace has an owner.</span>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
          {rows.slice(0, pager.shown).map((e) => (
            <li key={e.id} style={{ display: "grid", gridTemplateColumns: "minmax(280px, 2fr) minmax(200px, 3fr)", gap: space[16], padding: `${space[12]}px ${space[8]}px`, borderTop: `1px solid ${color.line}`, alignItems: "center" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
                <span style={{ ...type.heading, overflowWrap: "anywhere" }}>{e.name}</span>
                <EntityIdLine id={e.id} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: space[4], minWidth: 0 }}>
                <span style={{ ...type.body, color: color.textSecondary, overflowWrap: "anywhere" }}>Billed for {e.caps.join(", ") || "nothing measurable"}</span>
                <span style={{ ...type.body, color: color.textTertiary, overflowWrap: "anywhere" }}>
                  {e.kind === "host"
                    ? Array.isArray(e.facts.tags) && (e.facts.tags as unknown[]).length
                      ? `Tags: ${(e.facts.tags as unknown[]).filter((t) => typeof t === "string").slice(0, 4).join(", ")}`
                      : "Host, no tags"
                    : "Namespace"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {pager.needed && <PagerFooter pager={pager} noun="hosts and namespaces" filterHint={false} />}
    </section>
  );
}

/** Every billed host and namespace with its owner, or "No owner": the file an admin sends to the teams. */
function EveryEntityCsv({ ents }: { ents: Ent[] }) {
  const tags = (e: Ent) => (Array.isArray(e.facts.tags) ? (e.facts.tags as unknown[]).filter((t): t is string => typeof t === "string").join("; ") : null);
  const columns: CsvColumn<Ent>[] = [
    { header: "Type", value: (e) => (e.kind === "host" ? "Host" : "Namespace") },
    { header: "Name", value: (e) => e.name },
    { header: "ID", value: (e) => e.id },
    { header: "Owner", value: (e) => e.owner?.name ?? NAME.noOwnerYet },
    { header: "Owner from", value: (e) => e.owner?.via ?? null },
    { header: "Host group", value: (e) => e.facts.hostGroup },
    { header: "Tags", value: tags },
    { header: "Capabilities billed", value: (e) => e.caps.join("; ") },
  ];
  const rows = [...ents].sort((a, b) => Number(a.owner !== null) - Number(b.owner !== null) || b.caps.length - a.caps.length || a.name.localeCompare(b.name));
  return <CsvDownload filtered={false} name="ownership" noun="hosts and namespaces" columns={columns} rows={rows} />;
}

function OwnershipSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <Bone w="70%" h={38} />
      <Bone w="60%" h={24} />
    </div>
  );
}

const teamGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 2fr) minmax(140px, 1fr) 120px minmax(160px, 1fr) 160px",
  gap: space[16],
  alignItems: "center",
};
