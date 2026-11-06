import React, { useMemo } from "react";
import { Toolbar, countOptions } from "../components/Toolbar";
import { PeriodDelta } from "../components/PeriodDelta";

import { color, space, type } from "../design/tokens";
import { Answer } from "../design/primitives";
import { RankedRows, concentrationAnswer, type RankedItem } from "../components/RankedList";
import { matches, useFilters, type FilterDef } from "../components/Filters";
import { Bone, DataAsOf, ENTITY_RESULT_RECORDS, QueryOutcome, ShowQuery, asNumber, useAppHref, useBillingQuery, usePeriod } from "../components/shared";
import { formatQuantity } from "../rates";
import { CsvDownload, type CsvColumn } from "../components/CsvDownload";

import { NextSteps } from "../components/NextSteps";
import { R } from "../routes";
/**
 * Buckets (Entities type, v0.10.1): the Grail buckets that bill Retain and
 * Ingest. Logs, events, traces and metrics are billed per bucket, never per
 * host or service, so this is the only named thing their usage attaches to.
 * Retain records are hourly snapshots of stored bytes (sum = byte-hours);
 * Ingest records carry bytes ingested in the interval.
 */
const GIB = 1073741824;

const BUCKETS_QUERY = `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT" and isNotNull(usage.bucket)
| filter contains(event.type, "Retain") or contains(event.type, "Ingest")
| dedup event.id
{IN_PERIOD}
| fieldsAdd family = if(contains(event.type, "Retain"), "retain", else: "ingest"),
    data = if(startsWith(event.type, "Log"), "Logs", else: if(startsWith(event.type, "Events"), "Events",
      else: if(startsWith(event.type, "Traces"), "Traces", else: if(startsWith(event.type, "Metrics"), "Metrics", else: event.type))))
| summarize {retain_byte_hours = sum(if(family == "retain", billed_bytes)),
    n_retain = countIf(family == "retain"),
    ingest_bytes = sum(if(family == "ingest", coalesce(billed_bytes, ingested_bytes))),
    n_ingest = countIf(family == "ingest"),
    data_points = sum(if(family == "ingest", data_points)),
    included = countIf(event.type == "Log Management & Analytics - Retain with Included Queries") > 0,
    last_record = max(timestamp)},
    by:{bucket = usage.bucket, data}`;

type Bucket = { id: string; name: string; data: string; avgGib: number | null; gibDays: number | null; ingestGib: number | null; dataPoints: number | null; included: boolean };

const FILTERS: FilterDef[] = [
  {
    key: "data",
    label: "Data",
    kind: "select",
    options: ["Logs", "Events", "Traces", "Metrics"].map((d) => ({ value: d, label: d })),
  },
  { key: "bucket", label: "Bucket", kind: "search" },
];

export const Buckets = () => {
  const { query, records, error, errorKind, partial, isLoading, retry, cancel, cancelled } = useBillingQuery(BUCKETS_QUERY, { maxRecords: ENTITY_RESULT_RECORDS });
  const period = usePeriod();
  const href = useAppHref();
  const f = useFilters(FILTERS);
  const days = Math.max(1, (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 86400000);

  const { buckets, last } = useMemo(() => {
    const out: Bucket[] = [];
    let newest: string | null = null;
    for (const r of records ?? []) {
      if (!r || typeof r.bucket !== "string") continue;
      const gibDays = asNumber(r.n_retain) > 0 ? asNumber(r.retain_byte_hours) / GIB / 24 : null;
      out.push({
        id: `${r.bucket}|${String(r.data)}`,
        name: r.bucket,
        data: String(r.data),
        gibDays,
        avgGib: gibDays === null ? null : gibDays / days,
        ingestGib: asNumber(r.n_ingest) > 0 && asNumber(r.ingest_bytes) > 0 ? asNumber(r.ingest_bytes) / GIB : null,
        dataPoints: asNumber(r.n_ingest) > 0 && asNumber(r.data_points) > 0 ? asNumber(r.data_points) : null,
        included: r.included === true,
      });
      if (typeof r.last_record === "string" && (!newest || r.last_record > newest)) newest = r.last_record;
    }
    return { buckets: out, last: newest };
  }, [records, days]);

  const shown = buckets.filter((b) => f.pick("data", b.data) && matches(b.name, f.values.bucket));
  const stored = shown.filter((b) => b.gibDays !== null);
  const ingestOnly = shown.filter((b) => b.gibDays === null);
  const [setup, conclusion] = concentrationAnswer(
    stored.map((b) => b.gibDays ?? 0),
    { one: "bucket", many: "buckets" },
    "stored data",
  );
  const items: RankedItem[] = stored.map((b) => ({
    id: b.id,
    name: b.name,
    detail: `${b.data}, about ${formatQuantity(b.avgGib ?? 0)} GiB stored on average${b.included ? ", Retain with Included Queries" : ""}`,
    value: b.gibDays ?? 0,
    extras: b.ingestGib !== null ? `Ingested ${formatQuantity(b.ingestGib)} GiB in the timeframe` : b.dataPoints !== null ? `Ingested ${formatQuantity(b.dataPoints)} data points` : undefined,
  }));

  const csvRows = [...[...stored].sort((a, b) => (b.gibDays ?? 0) - (a.gibDays ?? 0)), ...ingestOnly];
  const csvColumns: CsvColumn<Bucket>[] = [
    { header: "Bucket", value: (b) => b.name },
    { header: "Data", value: (b) => b.data },
    { header: "GiB-days stored", value: (b) => b.gibDays },
    { header: "Average GiB stored", value: (b) => b.avgGib },
    { header: "GiB ingested", value: (b) => b.ingestGib },
    { header: "Data points ingested", value: (b) => b.dataPoints },
    { header: "Retain with Included Queries", value: (b) => b.included },
  ];

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
        empty={`No bucket billed Retain or Ingest in ${period.phrase}.`}
        skeleton={<Bone w="100%" h={300} r={14} />}
      >
        <Answer
          setup={stored.length > 0 ? setup : "No buckets"}
          conclusion={stored.length > 0 ? conclusion : "match the filters."}
          lead={`Grail buckets ranked by GiB-days stored in ${period.phrase}, with what was ingested into each. Logs, events, traces and metrics are billed per bucket, not per host or service.`}
          delta={<PeriodDelta filter={`contains(event.type, "Retain")`} quantity="toDouble(billed_bytes) / 1073741824 / 24" unit="GiB-days stored" />}
        />
        <DataAsOf last={last} />
        <Toolbar defs={FILTERS} f={f} counts={countOptions(buckets, { data: (b) => b.data })} />
        <RankedRows items={items} unit="GiB-days stored" itemLabel="Bucket" href={href} />
        {ingestOnly.length > 0 && (
          <section aria-label="Ingest only" style={{ display: "flex", flexDirection: "column", gap: space[8] }}>
            <h2 style={{ margin: 0, ...type.heading  }}>Billed for ingest only</h2>
            {/* One list per unit: GiB and data points can't share a column. */}
            {ingestOnly.some((b) => b.ingestGib !== null) && (
              <RankedRows
                items={ingestOnly.filter((b) => b.ingestGib !== null).map((b) => ({ id: b.id, name: b.name, detail: b.data, value: b.ingestGib ?? 0 }))}
                unit="GiB ingested"
                itemLabel="Bucket"
                href={href}
              />
            )}
            {ingestOnly.some((b) => b.ingestGib === null && b.dataPoints !== null) && (
              <RankedRows
                items={ingestOnly.filter((b) => b.ingestGib === null && b.dataPoints !== null).map((b) => ({ id: b.id, name: b.name, detail: b.data, value: b.dataPoints ?? 0 }))}
                unit="data points ingested"
                itemLabel="Bucket"
                href={href}
              />
            )}
          </section>
        )}
        <CsvDownload name="buckets" noun="buckets" columns={csvColumns} rows={csvRows} />
        <span style={{ ...type.body, color: color.textTertiary }}>
          Bucket names come from the billing records. Display names and retention periods need a permission this app does not request.
        </span>
      </QueryOutcome>
      <NextSteps links={[{ to: R.fixes, label: "Check buckets stored longer than they are queried" }, { to: R.queries, label: "See who queries the most" }]} />
      <ShowQuery query={query} />
    </div>
  );
};
