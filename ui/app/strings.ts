/**
 * each thing, the money-layer and estimate wording, the messages, and the one
 * note on where the figures come from. Screens import from here; text that
 * only names a row or a count stays with its screen but was reviewed against
 * the same rules.
 */

/** One name for each thing, everywhere. */
export const NAME = {
  costCentre: "cost centre",
  ratesInUse: "rates in use",
  checks: "checks",
  costAllocationExport: "Cost Allocation export",
  chargedToATeam: "Charged to a team",
  bySource: "By source",
  byPerson: "By person",
  personOrAccount: "Person or account",
  peopleAndAccounts: "people and accounts",
  monitoringMode: "Monitoring mode",
  monitoringModeUnknown: "Monitoring mode unknown",
  retainUnit: "GiB-days stored",
  environment: "environment",
  platformService: "Dynatrace's built-in services",
  smallGroups: "Small groups of people",
  noOwnerYet: "No owner yet",
  rangeBasis: "the quietest and busiest 7 days in the timeframe",
} as const;

/** Money layers: said on every figure. */
export const LAYER = {
  list: "List price, not your contract",
  contract: "Your contract rate (calculated)",
  edited: "Edited",
  noPrice: "No price",
} as const;

/** The one calm note on where the figures come from: the Glossary and the exports, not every screen. */
export const SOURCE_OF_TRUTH =
  "Figures are calculated from Dynatrace billing usage events, for guidance. The Dynatrace invoice and Account Management are the source of truth.";

/** FOCUS: say which parts follow it and which do not (never "FOCUS" alone). */
export const FOCUS_NOTE = {
  onScreen: "Column layout follows FOCUS (a FinOps standard for cost data); the file is not FOCUS-compliant. BilledCost is empty. EffectiveCost, ContractedCost and ListCost are calculated by this app; the x_RateSource column says at which rate. Columns starting x_ are this app's own.",
  inFile: "FOCUS layout, not FOCUS-compliant. BilledCost is empty because billing events are not an invoice. EffectiveCost, ContractedCost and ListCost are calculated by this app at the rate named in x_RateSource.",
  fileStem: "usage-focus-format",
} as const;

/** Messages a person reads when something is missing or went wrong. Calm, no blame, no "we". */
export const MSG = {
  noPermissionTitle: "This app can't show billed usage. Your account doesn't have permission to read Dynatrace system events.",
  noPermissionShort: "This app can't show billed usage.",
  noPermissionNext: "Ask your Dynatrace admin for read access to system events (the Read System Events policy), then reload.",
  cancelledTitle: "You cancelled this query.",
  cancelledNext: "Retry runs it again. A shorter timeframe is quicker.",
  stillRunning: "Still running. Large timeframes can take up to a minute; the result appears here when it arrives.",
  /** A check that needs the classic entity tables, in an environment that has only Smartscape. */
  noClassicCheck: "Can't check in this environment: it has no classic entity tables, which this check reads services from.",
  noClassicStatus: "Can't check here",
  noClassicRules: "Rules can't match in this environment: it has no classic entity tables, where host tags, host groups, zones and namespace details are read from. Owners come from cost centres only.",
  /** Period comparisons. */
  compareTruncated: "No comparison: the timeframe before this one reaches past the 365 days of billing data kept.",
  compareArriving: " The latest day is still arriving, so this timeframe may still rise.",
  unverifiedFields: "Field names for this capability come from the Dynatrace documentation and have not been checked against a record in this environment.",
} as const;

/** Keyboard shortcuts, listed in the Glossary (the app's help) and declared in app.config.json. */
export const SHORTCUT_HELP = {
  title: "Keyboard shortcuts",
  lead: "Six shortcuts for people who come back every week. None fires while you are typing in a field. Turn them off under Help, Keyboard shortcuts.",
} as const;
