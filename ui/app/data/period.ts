// Pure: no React, no SDK, so tests/dql.test.mjs runs it against the real query engine.

/**
 * One time base for every billing query (v0.12.11). {BILLING_WINDOW} fetches by write
 * time from the period start to 24 h past its end; {IN_PERIOD} then keeps records whose
 * usage started inside the period. A record is always written after its usage, so
 * nothing is fetched before the start. {TIMEFRAME} stays the exact window for
 * non-billing tables (query executions, entities).
 */
export const USAGE_TIME = "coalesce(toTimestamp(usage.start), toTimestamp(event.start), toTimestamp(query_start), timestamp)";

export function fillPeriod(template: string, period: { fromIso: string; toIso: string; fetchToIso: string }): string {
  const inPeriod = `| filter ${USAGE_TIME} >= toTimestamp("${period.fromIso}") and ${USAGE_TIME} < toTimestamp("${period.toIso}")`;
  return template
    .split("{BILLING_WINDOW}").join(`"${period.fromIso}", to: "${period.fetchToIso}"`)
    .split("{TIMEFRAME_PADDED}").join(`"${period.fromIso}", to: "${period.fetchToIso}"`)
    .split("{IN_PERIOD}").join(inPeriod)
    .split("{TIMEFRAME}").join(`"${period.fromIso}", to: "${period.toIso}"`)
    .split("{FROM}").join(period.fromIso)
    .split("{TO}").join(period.toIso);
}
