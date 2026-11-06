import React from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { space } from "../design/tokens";
import { Segmented } from "../design/primitives";
import { ENTITY_TYPES, R, type EntityType } from "../routes";
import { Hosts } from "./Hosts";
import { Kubernetes } from "./Kubernetes";
import { Buckets } from "./Buckets";
import { Applications } from "./Applications";

/**
 * Entities (v0.10.0): one Consumption screen for the billed things, with a
 * type switch instead of separate sidebar items. Each type renders its
 * existing screen unchanged; switching keeps the query string (timeframe and
 * filters). Workflows have no entity screen.
 */
export const Entities = () => {
  const { type: t } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const current = ENTITY_TYPES.find((e) => e.value === t)?.value;
  if (!current) return <Navigate to={`${R.entities("hosts")}${search}`} replace />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      {/* A type switch is a view change: it adds a history entry, so Back returns to the
          previous type. Only the timeframe carries over; one type's filters
          and grouping mean nothing on another. */}
      <Segmented<EntityType> label="Entity type" value={current} onChange={(v) => navigate(`${R.entities(v)}${timeframeOnly(search)}`)} options={ENTITY_TYPES} />
      {current === "hosts" && <Hosts />}
      {current === "kubernetes" && <Kubernetes />}
      {current === "applications" && <Applications show="applications" />}
      {current === "monitors" && <Applications show="monitors" />}
      {current === "buckets" && <Buckets />}
    </div>
  );
};

function timeframeOnly(search: string): string {
  const p = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ["from", "to"]) {
    const v = p.get(k);
    if (v) keep.set(k, v);
  }
  const q = keep.toString();
  return q ? `?${q}` : "";
}
