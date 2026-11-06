import React from "react";

import { color, radius, space, type } from "../design/tokens";
import { Marker } from "../design/primitives";
import { SOURCE_LABEL, useRates, type RateSource } from "../rates";
import { LIST_PRICE_SOURCE } from "../data/listPrices";
import { formatDay } from "../locale";
import { R } from "../routes";
import { Info, type Guide } from "./Info";
import { AppLinkTo } from "./shared";

/**
 * Honesty labels (v0.10.0). Visible next to the figures they qualify, never
 * as a footnote.
 */
const chip: React.CSSProperties = {
  ...type.label,
  textTransform: "none",
  letterSpacing: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: space[8],
  height: 24,
  padding: `0 ${space[8]}px`,
  borderRadius: radius.chip,
  border: `1px solid ${color.lineStrong}`,
  color: color.textSecondary,
  whiteSpace: "nowrap",
  verticalAlign: "middle",
  // Never stretch when the parent is a flex column.
  alignSelf: "flex-start",
};

/**
 * Where the money next to it comes from. A list price is the default when no
 * rate card or contract is set, so it gets the signal marker: it is not the
 * customer's contract.
 */
const PRICE_GUIDE: Record<RateSource, Guide> = {
  list: {
    what: `Dynatrace's public list price for each capability (rate card page updated ${formatDay(LIST_PRICE_SOURCE.pageModified)}). Contracts usually differ.`,
    how: "Connect Account Management on the Rate card to use your contract rates, or edit a rate yourself.",
  },
  contract: {
    what: "Your Account Management cost divided by your billed usage over recent closed days: a calculated rate, not a line from your contract.",
    how: "Reconnect or change it on the Rate card.",
  },
  edited: {
    what: "A rate you entered on the Rate card. It applies for your user only.",
  },
};

/** List price shown while contract rates are connected: only some capabilities fell back to it, and why. */
const LIST_WITH_CONTRACT: Guide = {
  what: "Account Management showed no cost for some capabilities in the days used to calculate your contract rates, so those keep Dynatrace's public list price. The rest use your contract rate.",
  how: "The Rate card lists which capabilities use the list price.",
};

export function PriceTag({ sources }: { sources: Iterable<RateSource> }) {
  const hasContract = Boolean(useRates().contract);
  const list = [...new Set(sources)];
  if (!list.length) return null;
  const order: RateSource[] = ["list", "contract", "edited"];
  return (
    <span style={{ display: "inline-flex", gap: space[8], flexWrap: "wrap" }}>
      {order
        .filter((s) => list.includes(s))
        .map((s) => (
          // The chip is the question a finance reader asks ("so what does my contract say?"): it opens the answer.
          <Info key={s} label={SOURCE_LABEL[s]} guide={s === "list" && hasContract ? LIST_WITH_CONTRACT : PRICE_GUIDE[s]} triggerStyle={chip} action={<AppLinkTo to={R.rates}>Open the Rate card →</AppLinkTo>}>
            {s === "list" && <Marker tone="muted" />}
            <span className="lc-visually-hidden">Prices: </span>
            {SOURCE_LABEL[s]}
          </Info>
        ))}
    </span>
  );
}

/** Features built against documentation but not yet exercised on a real subscription. */
export function PreviewTag() {
  return <span style={chip}>Preview</span>;
}
