import React from "react";
import { R } from "../routes";
import { Crumbs } from "./shared";

/** Drill-down screens from the Overview: one quiet "‹ Overview" link back (v0.12.11). */
export function DrillHeader({ here }: { here: string }) {
  return <Crumbs trail={[{ label: "Overview", to: R.overview }, { label: here }]} />;
}
