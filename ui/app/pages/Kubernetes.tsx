import React, { useMemo } from "react";
import { NAME } from "../strings";
import { Toolbar, countOptions } from "../components/Toolbar";
import { PeriodDelta } from "../components/PeriodDelta";

import { color, space, type, layout } from "../design/tokens";
import { Answer } from "../design/primitives";
import { PagerFooter, RankedRows, concentrationAnswer, usePager, type RankedItem } from "../components/RankedList";
import { matches, useFilters, type FilterDef } from "../components/Filters";
import { Bone, DataAsOf, ENTITY_RESULT_RECORDS, QueryOutcome, ShowQuery, asNumber, useAppHref, useBillingQuery, usePeriod } from "../components/shared";
import { CsvDownload, type CsvColumn } from "../components/CsvDownload";
import { costCentreOwner, namespaceOwner, ownerText, useOwnerRules, type Owner } from "../data/ownership";
import { displayName, nameState } from "../components/EntityName";
import { COST_CENTRE_FIELDS } from "../funnel";
import { formatQuantity } from "../rates";

import { NextSteps } from "../components/NextSteps";
import { R } from "../routes";
const KPM = "Kubernetes Platform Monitoring";

/**
 * Kubernetes: pod-hours by cluster, then namespace, with owner coverage.
 * Smartscape cluster and namespace ids are different identifiers from the
 * entity ids (KUBERNETES_CLUSTER-… vs K8S_CLUSTER-…), so they cannot be merged;
 * the entity id is the key and the smartscape id is a fallback (then the name
 * cannot be resolved). Namespace labels and annotations feed ownership rules.
 */
const K8S_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and event.type == "${KPM}"
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| fieldsAdd cluster_id = coalesce(dt.entity.kubernetes_cluster, toString(dt.smartscape.k8s_cluster)),
    ns_id = coalesce(dt.entity.cloud_application_namespace, toString(dt.smartscape.k8s_namespace))
| summarize {pod_hours = sum(billed_pod_hours),
    n_measured = countIf(isNotNull(billed_pod_hours)),
    cost_centres = collectDistinct(cost_centre),
    last_record = max(timestamp)},
    by:{cluster_id, ns_id}
| lookup [fetch dt.entity.kubernetes_cluster | fields id, entity.name], sourceField: cluster_id, lookupField: id, prefix: "cluster."
| lookup [fetch dt.entity.cloud_application_namespace | fields id, entity.name, namespaceName, cloudApplicationLabels, kubernetesAnnotations, managementZones], sourceField: ns_id, lookupField: id, prefix: "ns."`;

type Ns = { id: string; name: string; clusterId: string; cluster: string; podHours: number; owner: Owner | null };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export const Kubernetes = () => {
  const { query, records, error, errorKind, partial, isLoading, retry, cancel, cancelled } = useBillingQuery(K8S_QUERY, { maxRecords: ENTITY_RESULT_RECORDS });
  const { value: rules } = useOwnerRules();
  const period = usePeriod();
  const href = useAppHref();

  const { namespaces, last } = useMemo(() => {
    const out: Ns[] = [];
    let newest: string | null = null;
    for (const r of records ?? []) {
      if (!r || asNumber(r.n_measured) === 0) continue;
      const clusterId = String(r.cluster_id);
      const id = String(r.ns_id);
      const owner =
        costCentreOwner(r.cost_centres) ??
        namespaceOwner(
          {
            name: str(r["ns.namespaceName"]) ?? str(r["ns.entity.name"]),
            labels: r["ns.cloudApplicationLabels"],
            annotations: r["ns.kubernetesAnnotations"],
            managementZones: r["ns.managementZones"],
          },
          rules,
        );
      out.push({
        id,
        name: displayName(str(r["ns.entity.name"]), "namespace", nameState(r["ns.id"], r["ns.entity.name"])),
        clusterId,
        cluster: displayName(str(r["cluster.entity.name"]), "cluster", nameState(r["cluster.id"], r["cluster.entity.name"])),
        podHours: asNumber(r.pod_hours),
        owner,
      });
      if (typeof r.last_record === "string" && (!newest || r.last_record > newest)) newest = r.last_record;
    }
    return { namespaces: out, last: newest };
  }, [records, rules]);

  const clusters = [...new Map(namespaces.map((n) => [n.clusterId, n.cluster])).entries()];
  const defs: FilterDef[] = [
    { key: "cluster", label: "Cluster", kind: "select", options: clusters.map(([id, name]) => ({ value: id, label: name })) },
    { key: "ns", label: "Namespace", kind: "search" },
    {
      key: "owner",
      label: "Owner",
      kind: "select",
      single: true,
      options: [
        { value: "yes", label: "Has an owner" },
        { value: "no", label: NAME.noOwnerYet },
      ],
    },
  ];
  const f = useFilters(defs);
  const shown = namespaces.filter(
    (n) =>
      f.pick("cluster", n.clusterId) &&
      matches(n.name, f.values.ns) &&
      (!f.values.owner || (f.values.owner === "yes") === (n.owner !== null)),
  );

  const [setup, conclusion] = concentrationAnswer(
    shown.map((n) => n.podHours),
    { one: "namespace", many: "namespaces" },
    "Kubernetes pod-hours",
  );
  const owned = shown.filter((n) => n.owner);
  const totalHours = shown.reduce((a, n) => a + n.podHours, 0);
  const ownedHours = owned.reduce((a, n) => a + n.podHours, 0);
  const zero = shown.filter((n) => n.podHours === 0).length;
  const pct = (part: number, whole: number) =>
    whole === 0 ? "none" : part > 0 && part / whole < 0.01 ? "less than 1%" : `${Math.round((part / whole) * 100)}%`;

  // Clusters ranked by their pod-hours; namespaces ranked within each.
  const byCluster = clusters
    .map(([id, name]) => {
      const ns = shown.filter((n) => n.clusterId === id);
      return { id, name, ns, hours: ns.reduce((a, n) => a + n.podHours, 0) };
    })
    .filter((c) => c.ns.length > 0)
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  const clusterPager = usePager(byCluster.length);
  const csvRows = byCluster.flatMap((c) => [...c.ns].sort((a, b) => b.podHours - a.podHours));
  const csvColumns: CsvColumn<Ns>[] = [
    { header: "Cluster", value: (n) => n.cluster },
    { header: "Cluster ID", value: (n) => n.clusterId },
    { header: "Namespace", value: (n) => n.name },
    { header: "Namespace ID", value: (n) => n.id },
    { header: "Pod-hours", value: (n) => n.podHours },
    { header: "Owner", value: (n) => n.owner?.name ?? NAME.noOwnerYet },
    { header: "Owner from", value: (n) => n.owner?.via ?? null },
  ];

  const clusterList = (
    <>
      {byCluster.slice(0, clusterPager.shown).map((c, i) => {
        const items: RankedItem[] = c.ns.map((n) => ({
          id: n.id,
          name: n.name,
          entityId: n.id,
          value: n.podHours,
          extras: ownerText(n.owner),
        }));
        const summary = (
          <span style={{ display: "flex", justifyContent: "space-between", gap: space[16], flexWrap: "wrap", flex: 1 }}>
            <h3 style={{ margin: 0, ...type.heading  }}>Cluster {c.name}</h3>
            <span style={{ ...type.body, color: color.textSecondary }}>
              {formatQuantity(c.hours)} pod-hours, {c.ns.length} {c.ns.length === 1 ? "namespace" : "namespaces"}
            </span>
          </span>
        );
        // One cluster: its namespaces directly. Several: one line per cluster, the largest open.
        return byCluster.length === 1 ? (
          <section key={c.id} aria-label={`Cluster ${c.name}`} style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            {summary}
            <RankedRows items={items} unit="pod-hours" itemLabel="Namespace" href={href} />
          </section>
        ) : (
          <section key={c.id} aria-label={`Cluster ${c.name}`} style={{ borderTop: `1px solid ${color.line}`, paddingTop: space[12] }}>
            <details className="lc-details lc-lever" open={i === 0}>
              <summary style={{ padding: `${space[4]}px 0` }}>{summary}</summary>
              <div style={{ paddingTop: space[12] }}>
                <RankedRows items={items} unit="pod-hours" itemLabel="Namespace" href={href} />
              </div>
            </details>
          </section>
        );
      })}
      {clusterPager.needed && <PagerFooter pager={clusterPager} noun="clusters" filterHint={false} />}
    </>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome
        query={query}
        records={records}
        error={error}
        errorKind={errorKind}
        partial={partial}
        isLoading={isLoading}
        retry={retry} cancel={cancel} cancelled={cancelled}
        empty={`No Kubernetes Platform Monitoring usage was billed in ${period.phrase}.`}
        skeleton={<K8sSkeleton />}
      >
        <Answer
          setup={shown.length > 0 ? setup : "No namespaces"}
          conclusion={shown.length > 0 ? conclusion : "match the filters."}
          lead={`Pod-hours billed in ${period.phrase}, by cluster and then namespace. ${owned.length} of ${shown.length} namespaces have an owner${totalHours > 0 ? `, covering ${pct(ownedHours, totalHours)} of the pod-hours` : ""}.`}
          delta={<PeriodDelta filter={`event.type == "Kubernetes Platform Monitoring"`} quantity="billed_pod_hours" unit="pod-hours" />}
        />
        <DataAsOf last={last} />
        <Toolbar defs={defs} f={f} counts={countOptions(namespaces, { cluster: (n) => n.clusterId, owner: (n) => (n.owner ? "yes" : "no") })} />
        {/* Every namespace at zero: one closed line, not a long list of zeros.
            The sentence above already says nothing was billed; the list stays one click away. */}
        {shown.length > 0 && totalHours === 0 ? (
          <details className="lc-details lc-lever">
            <summary style={{ ...type.body, padding: `${space[4]}px 0` }}>
              Show the {shown.length} {shown.length === 1 ? "namespace" : "namespaces"}, all at 0 pod-hours
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: space[16], paddingTop: space[12] }}>{clusterList}</div>
          </details>
        ) : (
          clusterList
        )}
        <CsvDownload name="kubernetes-namespaces" noun="namespaces" columns={csvColumns} rows={csvRows} />
        {zero > 0 && (
          <span style={{ ...type.body, color: color.textTertiary }}>
            {zero} of {shown.length} namespaces have billing records that measure 0 pod-hours. They are measured zeros,
            not missing data.
          </span>
        )}
      </QueryOutcome>
      <NextSteps links={[{ to: R.ownership, label: "Give namespaces an owner" }]} />
      <ShowQuery query={query} />
    </div>
  );
};

function K8sSkeleton() {
  return (
    <div role="status" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <section style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: layout.content }}>
        <Bone w="80%" h={38} />
        <Bone w="65%" h={48} />
      </section>
      {[0, 1].map((k) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
          <Bone w={220} h={22} />
          {[0, 1, 2].map((i) => (
            <Bone key={i} w="100%" h={78} r={8} />
          ))}
        </div>
      ))}
    </div>
  );
}
