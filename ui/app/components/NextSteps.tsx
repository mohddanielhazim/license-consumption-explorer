import React from "react";
import { Link } from "react-router-dom";

import { color, space, type } from "../design/tokens";
import { Label } from "../design/primitives";
import { useAppHref } from "./shared";

/**
 * Where people usually go from here (v0.12.8): one or two links at the foot
 * of a screen, so the next question is a click away instead of a guess.
 * Links keep the timeframe.
 */
export function NextSteps({ links }: { links: { to: string; label: string }[] }) {
  const href = useAppHref();
  if (!links.length) return null;
  return (
    // One line, no rule above it (v0.12.32): space already separates it from the content.
    <nav aria-label="Next" style={{ display: "flex", alignItems: "baseline", gap: `${space[8]}px ${space[24]}px`, flexWrap: "wrap" }}>
      <Label>Next</Label>
      <span style={{ display: "contents" }}>
        {links.map((l) => (
          <Link key={l.to + l.label} to={href(l.to)} className="lc-link" style={{ ...type.body, color: color.textPrimary }}>
            {l.label} →
          </Link>
        ))}
      </span>
    </nav>
  );
}
