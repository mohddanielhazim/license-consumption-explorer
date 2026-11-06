import { useEffect, useState } from "react";
import { effectivePermissionsClient } from "@dynatrace-sdk/client-platform-management-service";

export type Grant = "true" | "false" | "condition";

/**
 * The permissions this app needs to show licence consumption, checked once at
 * start-up. Apps must list every permission they check
 * in their scopes; all three are already declared in app.config.json.
 *   - storage:system:read + storage:buckets:read on dt.system.events:
 *     billing usage events ("Read System Events" default policy)
 *   - storage:entities:read: host, namespace and application names
 */
const CHECKS = [
  { permission: "storage:system:read" },
  {
    permission: "storage:buckets:read",
    context: [{ key: "storage:table-name", value: "dt.system.events" }],
  },
  { permission: "storage:entities:read" },
];

export type PermissionState =
  | { status: "checking" }
  /** The check itself failed: do not block the app, the queries will tell. */
  | { status: "unknown" }
  | { status: "known"; systemEvents: Grant; entities: Grant };

export function usePermissions(): PermissionState {
  const [state, setState] = useState<PermissionState>({ status: "checking" });
  useEffect(() => {
    let live = true;
    effectivePermissionsClient
      .resolveEffectivePermissions({ body: { permissions: CHECKS } })
      .then((res) => {
        const g = (p: string): Grant => res.find((r) => r.permission === p)?.granted ?? "false";
        const system = g("storage:system:read");
        const buckets = g("storage:buckets:read");
        const systemEvents: Grant =
          system === "false" || buckets === "false" ? "false" : system === "true" && buckets === "true" ? "true" : "condition";
        if (live) setState({ status: "known", systemEvents, entities: g("storage:entities:read") });
      })
      .catch(() => live && setState({ status: "unknown" }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
