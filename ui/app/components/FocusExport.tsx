import { FOCUS_NOTE, LAYER, SOURCE_OF_TRUTH } from "../strings";
import { appLocale } from "../locale";
import React, { useEffect, useRef, useState } from "react";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";

import { color, space, type } from "../design/tokens";
import { SecondaryButton } from "../design/primitives";
import { useBillingQuery, usePeriod } from "./shared";

/** The export runs on request only, so it may return far more rows than a screen. */
const EXPORT_RESULT_RECORDS = 1000000;
import { useDiscovery } from "./useMeasuredQuery";
import { COST_CENTRE_FIELDS, compactQuantity } from "../funnel";
import { nativeDisplay } from "../capabilities";
import { LIST_PRICES_USD } from "../data/listPrices";
import { Info } from "./Info";
import { SOURCE_LABEL, useRates } from "../rates";

/**
 * FOCUS-shaped CSV export, one row per UTC day,
 * capability and host or namespace (or "not linked"). Column names follow the
 * FinOps FOCUS specification; app-specific columns are prefixed x_.
 * BilledCost is left empty on purpose: billing events are not an invoice
 *.
 * EffectiveCost is the cost at the rate in use; ContractedCost and ListCost are
 * filled only where that rate source applies.
 */
/** Compact (v0.12.3): one quantity per row, the shared cost-centre rule, up to a million rows. */
const exportQuery = (qty: string) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
{IN_PERIOD}
${COST_CENTRE_FIELDS}
| fieldsAdd qty = ${qty}
| fieldsAdd usage_day = bin(coalesce(toTimestamp(usage.start), toTimestamp(event.start), toTimestamp(query_start), timestamp), 24h),
    resource_id = coalesce(toString(dt.smartscape.host), dt.entity.host, dt.entity.cloud_application_namespace, toString(dt.smartscape.k8s_namespace), ""),
    resource_type = if(isNotNull(dt.smartscape.host) or isNotNull(dt.entity.host), "Host",
      else: if(isNotNull(dt.entity.cloud_application_namespace) or isNotNull(dt.smartscape.k8s_namespace), "Kubernetes namespace", else: ""))
| summarize {qty = sum(qty), n_qty = countIf(isNotNull(qty)), cost_centre = takeMax(cost_centre)},
    by:{usage_day, event.type, resource_id, resource_type}
| lookup [fetch dt.entity.host | fields id, entity.name], sourceField: resource_id, lookupField: id, prefix: "host."
| lookup [fetch dt.entity.cloud_application_namespace | fields id, entity.name], sourceField: resource_id, lookupField: id, prefix: "ns."`;

const COLUMNS = [
  "BillingPeriodStart",
  "BillingPeriodEnd",
  "ChargePeriodStart",
  "ChargePeriodEnd",
  "ChargeCategory",
  "ChargeDescription",
  "BilledCost",
  "EffectiveCost",
  "ContractedCost",
  "ContractedUnitPrice",
  "ListCost",
  "ListUnitPrice",
  "BillingCurrency",
  "ConsumedQuantity",
  "ConsumedUnit",
  "PricingQuantity",
  "PricingUnit",
  "ProviderName",
  "PublisherName",
  "InvoiceIssuerName",
  "ServiceCategory",
  "ServiceName",
  "SubAccountId",
  "ResourceId",
  "ResourceName",
  "ResourceType",
  "Tags",
  "x_RateSource",
  "x_Note",
] as const;

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  // Trim binary floating-point noise (2.6350000000000002 → 2.635).
  // Text a spreadsheet would run as a formula (=, +, -, @) is prefixed with an apostrophe, as in every CSV.
  const s = typeof v === "number" ? String(Number(v.toPrecision(12))) : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function envId(): string {
  try {
    return getEnvironmentId();
  } catch {
    return "";
  }
}

export function FocusExport() {
  const [requested, setRequested] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const done = useRef(false);
  const period = usePeriod();
  const rates = useRates();
  const { discovery, resolve, qty } = useDiscovery();
  const ready = discovery.records !== undefined && discovery.records.length > 0;
  const q = useBillingQuery(exportQuery(qty), { enabled: requested && ready, maxRecords: EXPORT_RESULT_RECORDS });

  useEffect(() => {
    if (!requested || done.current) return;
    if (q.error) {
      setNote("The export query failed. Try again; nothing was downloaded.");
      setRequested(false);
      return;
    }
    if (!q.records) return;
    done.current = true;
    const env = envId();
    const lines: string[] = [COLUMNS.join(",")];
    let rows = 0;
    for (const r of q.records) {
      if (!r) continue;
      const eventType = String(r["event.type"]);
      const cap = resolve(eventType);
      const quantity = compactQuantity(r);
      if (quantity === null) continue;
      const day = typeof r.usage_day === "object" && r.usage_day !== null ? (r.usage_day as { start?: string }).start : r.usage_day;
      if (typeof day !== "string") continue;
      const start = `${day.slice(0, 10)}T00:00:00Z`;
      const end = new Date(Date.parse(start) + 86400000).toISOString().replace(".000Z", "Z");
      const pricing = cap.toRateUnits(quantity);
      const rate = rates.rateFor(eventType);
      const listUnit = rates.currency === "USD" ? (LIST_PRICES_USD[eventType] ?? null) : null;
      const effective = rate ? pricing * rate.value : null;
      const resourceId = typeof r.resource_id === "string" ? r.resource_id : "";
      const resourceName =
        (typeof r["host.entity.name"] === "string" && r["host.entity.name"]) || (typeof r["ns.entity.name"] === "string" && r["ns.entity.name"]) || "";
      const cc = typeof r.cost_centre === "string" && r.cost_centre ? r.cost_centre : null;
      const row: Record<(typeof COLUMNS)[number], string | number | null> = {
        BillingPeriodStart: period.fromIso,
        BillingPeriodEnd: period.toIso,
        ChargePeriodStart: start,
        ChargePeriodEnd: end,
        ChargeCategory: "Usage",
        ChargeDescription: `${eventType}, ${cap.nativeUnit}`,
        BilledCost: null,
        EffectiveCost: effective,
        ContractedCost: rate?.source === "contract" ? effective : null,
        ContractedUnitPrice: rate?.source === "contract" ? rate.value : null,
        ListCost: listUnit !== null ? pricing * listUnit : null,
        ListUnitPrice: listUnit,
        BillingCurrency: rates.currency,
        ConsumedQuantity: nativeDisplay(cap, quantity),
        ConsumedUnit: cap.nativeUnit,
        PricingQuantity: pricing,
        PricingUnit: cap.rateUnit.replace(/^per /, ""),
        ProviderName: "Dynatrace",
        PublisherName: "Dynatrace",
        InvoiceIssuerName: "Dynatrace",
        ServiceCategory: "Management and Governance",
        ServiceName: eventType,
        SubAccountId: env,
        ResourceId: resourceId || null,
        ResourceName: resourceName || (resourceId ? "Unnamed or deleted" : null),
        ResourceType: typeof r.resource_type === "string" && r.resource_type ? r.resource_type : null,
        Tags: cc ? JSON.stringify({ "dt.cost.costcenter": cc }) : null,
        x_RateSource: rate ? SOURCE_LABEL[rate.source] : LAYER.noPrice,
        // The note once, on the first row: not repeated on every line of the file.
        x_Note: rows === 0 ? `${FOCUS_NOTE.inFile} ${SOURCE_OF_TRUTH}` : null,
      };
      lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
      rows += 1;
    }
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${FOCUS_NOTE.fileStem}-${env || "environment"}-${period.fromIso.slice(0, 10)}-to-${period.toIso.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNote(
      `${rows.toLocaleString(appLocale())} rows: download started.` +
        (q.partial || q.records.length >= EXPORT_RESULT_RECORDS ? " The result hit the record limit, so the file is incomplete: choose a shorter timeframe." : ""),
    );
    setRequested(false);
  }, [requested, q.records, q.error, q.partial, resolve, rates, period]);

  return (
    <div style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
      <SecondaryButton
        onClick={
          requested
            ? undefined
            : () => {
                done.current = false;
                setNote(null);
                setRequested(true);
              }
        }
      >
        {requested ? "Preparing the file…" : "Export CSV in FOCUS layout"}
      </SecondaryButton>
      <Info
        label="CSV in FOCUS layout"
        guide={{
          what: "A CSV whose columns follow FOCUS, a FinOps standard for cost data: one row per UTC day, capability and host or namespace, for finance tools.",
          why: "BilledCost is left empty, so the file is not FOCUS-compliant: billing events are not an invoice.",
          how: "EffectiveCost is the cost at the rate in use. ContractedCost is filled only with a calculated contract rate, ListCost only with list prices. x_RateSource says which.",
          where: "This environment's billing events, the same records the Spend screen reads.",
        }}
      />
      <span role="status" style={{ ...type.body, color: color.textTertiary }}>
        {note ? `${note} ` : ""}
        {FOCUS_NOTE.onScreen}
      </span>
    </div>
  );
}
