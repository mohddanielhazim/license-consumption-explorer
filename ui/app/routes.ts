/**
 * Every route in one place (v0.10.0): two workspaces, Consumption (units) and
 * Cost (money), plus shared screens outside both. Old routes redirect here so
 * no existing link breaks; redirects keep the query string (timeframe, filters).
 */
export type Workspace = "consumption" | "cost";
export type EntityType = "hosts" | "kubernetes" | "applications" | "monitors" | "buckets";

export const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "hosts", label: "Hosts" },
  { value: "kubernetes", label: "Kubernetes" },
  { value: "applications", label: "Applications" },
  { value: "monitors", label: "Synthetic monitors" },
  { value: "buckets", label: "Buckets" },
];

export const R = {
  // Home (v0.12.8): the four answers, where the app opens
  home: "/",
  // Consumption
  overview: "/consumption",
  notLinked: "/consumption/not-linked",
  usage: "/consumption/usage",
  entities: (t: EntityType = "hosts") => `/consumption/entities/${t}`,
  host: (id: string) => `/consumption/entities/hosts/${id}`,
  ownership: "/consumption/ownership",
  // Cost
  spend: "/cost",
  perHost: "/cost/per-host",
  fixes: "/cost/fixes",
  budgets: "/cost/budgets",
  // Rate card sits under Cost and Queries under Consumption (v0.12.32: three destinations, not seven)
  rates: "/cost/rates",
  // Under Rate card (v0.12.39): it compares with Account Management, which is connected there,
  // and Cost keeps five tabs, which fit beside the timeframe at 1024 wide.
  reconcile: "/cost/rates/reconcile",
  amSetup: "/cost/rates/account-management",
  queries: "/consumption/queries",
  // Help menu
  glossary: "/glossary",
  diagnostics: "/explore",
} as const;

export const WORKSPACE_HOME: Record<Workspace, string> = { consumption: R.overview, cost: R.spend };

/** Old route → new route. ":hostId" is carried over. */
export const OLD_ROUTES: [string, string][] = [
  ["/usage", R.usage],
  ["/hosts", R.entities("hosts")],
  ["/hosts/:hostId", "/consumption/entities/hosts/:hostId"],
  ["/kubernetes", R.entities("kubernetes")],
  ["/applications", R.entities("applications")],
  ["/not-linked", R.notLinked],
  ["/ownership", R.ownership],
  ["/spend", R.spend],
  ["/stacking", R.perHost],
  ["/fixes", R.fixes],
  ["/reconcile", R.reconcile],
  ["/consumption/entities", R.entities("hosts")],
  ["/cost/spend", R.spend],
  // v0.12.32 moves
  ["/rates", R.rates],
  ["/setup/account-management", R.amSetup],
  ["/queries", R.queries],
  ["/cost/reconcile", R.reconcile],
];

export function workspaceOf(pathname: string): Workspace | null {
  if (pathname === "/cost" || pathname.startsWith("/cost/")) return "cost";
  if (pathname === "/consumption" || pathname.startsWith("/consumption/")) return "consumption";
  return null;
}

/** The label shown in the header for a path. */
export function sectionFor(pathname: string): string {
  const exact: Record<string, string> = {
    [R.home]: "Home",
    [R.overview]: "Overview",
    [R.notLinked]: "Overview",
    [R.usage]: "Usage",
    [R.ownership]: "Ownership",
    [R.spend]: "Spend",
    [R.perHost]: "Cost per host",
    [R.fixes]: "Findings",
    [R.budgets]: "Team budgets",
    [R.reconcile]: "Reconcile",
    [R.rates]: "Rate card",
    [R.amSetup]: "Rate card",
    [R.queries]: "Queries",
    [R.glossary]: "Glossary",
    [R.diagnostics]: "Diagnostics",
  };
  if (exact[pathname]) return exact[pathname];
  if (pathname.startsWith("/consumption/entities")) return "Entities";
  return "";
}
