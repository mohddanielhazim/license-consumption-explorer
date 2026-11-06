import React from "react";
import { capabilityLabel } from "../capabilities";

import { color } from "../design/tokens";
import { NOT_CHARGED, NOT_CHARGED_NAME, NOT_CHARGED_URL } from "../data/listPrices";

/** "Dynatrace lists it as not charged yet", linked to Dynatrace's Preview program page (the source). */
export function NotChargedLink({ children = "Dynatrace lists it as not charged yet" }: { children?: React.ReactNode }) {
  return (
    <a href={NOT_CHARGED_URL} target="_blank" rel="noopener noreferrer" style={{ color: color.accent }}>
      {children}
    </a>
  );
}

/**
 * One sentence for capabilities left out of a cost total: the free-for-now ones
 * with a link to why, the rest because they have no price.
 */
export function NotIncluded({ types }: { types: string[] }) {
  const free = types.filter((t) => NOT_CHARGED[t]);
  const none = types.filter((t) => !NOT_CHARGED[t]);
  const names = (ts: string[]) => ts.map((t) => NOT_CHARGED_NAME[t] ?? capabilityLabel(t)).join(", ");
  return (
    <>
      {free.length > 0 && (
        <>
          {" "}
          {names(free)} {free.length === 1 ? "isn't" : "aren't"} included:{" "}
          <NotChargedLink>{`Dynatrace lists ${free.length === 1 ? "it" : "them"} as not charged yet`}</NotChargedLink>.
        </>
      )}
      {none.length > 0 && ` ${names(none)} ${none.length === 1 ? "has" : "have"} no price, so ${none.length === 1 ? "it isn't" : "they aren't"} included.`}
    </>
  );
}
