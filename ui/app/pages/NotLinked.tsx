import React, { useMemo } from "react";

import { color, space, type } from "../design/tokens";
import { Answer, Card } from "../design/primitives";
import { DrillHeader } from "../components/DrillHeader";
import { QueryOutcome, ShowQuery, periodPhrase, useTimeframe } from "../components/shared";
import { nativeDisplay, type Capability, capabilityLabel } from "../capabilities";
import { HAS_ENTITY, HAS_USER, quantityOf, quantitySums } from "../funnel";
import { useMeasuredQuery } from "../components/useMeasuredQuery";
import { formatQuantity } from "../rates";

/**
 * "See all N" from step 2: every usage type whose billing records name no
 * entity and no person, with what each billed, split by storage bucket (the
 * only thing these records do name). Same records the funnel counts as
 * stopping at step 2.
 */
const notLinkedQuery = (fields: string[]) => `fetch dt.system.events, from: {BILLING_WINDOW}
| filter event.kind == "BILLING_USAGE_EVENT"
| dedup event.id
{IN_PERIOD}
| filter not (${HAS_ENTITY}) and not (${HAS_USER})
| summarize ${quantitySums(fields)},
    by:{event.type, usage.bucket}`;

type Bucket = { name: string; quantity: number };
type TypeGroup = { eventType: string; cap: Capability; quantity: number; buckets: Bucket[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const NotLinked = () => {
  const { query, records, error, isLoading, retry, cancel, cancelled, resolve } = useMeasuredQuery(notLinkedQuery);
  const [tf] = useTimeframe();

  // Types this app can measure; anything else is named, not counted.
  const { groups, unmeasured } = useMemo(() => {
    const byType = new Map<string, TypeGroup>();
    const other = new Set<string>();
    for (const r of records ?? []) {
      if (!r) continue;
      const eventType = String(r["event.type"]);
      const cap = resolve(eventType);
      const q = quantityOf(r, cap);
      if (q === null) {
        other.add(eventType);
        continue;
      }
      const g = byType.get(eventType) ?? { eventType, cap, quantity: 0, buckets: [] };
      g.quantity += q;
      g.buckets.push({ name: typeof r["usage.bucket"] === "string" ? r["usage.bucket"] : "(no bucket named)", quantity: q });
      byType.set(eventType, g);
    }
    const list = [...byType.values()];
    list.forEach((g) => g.buckets.sort((a, b) => b.quantity - a.quantity));
    return { groups: list, unmeasured: [...other].sort() };
  }, [records, resolve]);

  // Consumption shows units only; each type in its own unit, so they are listed by name, not ranked.
  const ordered = [...groups].sort((a, b) => a.eventType.localeCompare(b.eventType));
  const n = groups.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <DrillHeader here="Not linked to anything" />
      <QueryOutcome query={query} records={records} error={error} isLoading={isLoading} retry={retry} cancel={cancel} cancelled={cancelled} empty={`No usage in ${periodPhrase(tf)} was left without a host, app or person.`}>
        <Answer
          setup={`${n} ${plural(n, "capability", "capabilities")}`}
          conclusion="can't yet be charged to a team."
          lead={`Their billing records name only a storage bucket: no host, app, person or cost centre. This is what each one billed in ${periodPhrase(tf)}, in its own unit. What it costs is on the Spend screen.`}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: space[16], alignItems: "stretch" }}>
          {ordered.map((g) => {
            return (
              <Card key={g.eventType} style={{ display: "flex", flexDirection: "column", gap: space[16] }}>
                <span style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
                  <span style={{ ...type.heading }}>{capabilityLabel(g.eventType)}</span>
                  <span style={{ ...type.body, color: color.textSecondary }}>
                    {formatQuantity(nativeDisplay(g.cap, g.quantity))} {g.cap.nativeUnit}
                  </span>
                </span>
                <span style={{ display: "flex", flexDirection: "column" }}>
                  {g.buckets.map((b) => (
                    <span
                      key={b.name}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: space[12],
                        padding: `${space[8]}px 0`,
                        borderTop: `1px solid ${color.line}`,
                        ...type.body,
                      }}
                    >
                      <span style={{ ...type.mono, color: color.textSecondary, alignSelf: "center" }}>{b.name}</span>
                      <span style={{ color: color.textPrimary, whiteSpace: "nowrap" }}>
                        {formatQuantity(nativeDisplay(g.cap, b.quantity))}
                      </span>
                    </span>
                  ))}
                </span>
              </Card>
            );
          })}
        </div>
        {unmeasured.length > 0 && (
          <span style={{ ...type.body, color: color.textTertiary }}>
            Also not linked, but no quantity field on these records: {unmeasured.join(", ")}.
          </span>
        )}
      </QueryOutcome>
      <ShowQuery query={query} />
    </div>
  );
};
