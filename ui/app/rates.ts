import { usePref, type PrefSpec, type Stored } from "./data/prefs";
import { appLocale } from "./locale";
import { LAYER } from "./strings";
import { LIST_PRICES_USD, LIST_PRICE_SOURCE } from "./data/listPrices";
import type { AmAlert, AmBudget, AmForecast, AmPeriod } from "./data/accountManagement";

/**
 * The rate card the user typed in from Account Management > Subscription >
 * Pricing, stored per user as { version, data }.
 *
 * There are no default rates anywhere in this app. A capability without an
 * entry in `rates` has no cost; blank means "not set", never 0.
 */
export type Commitment = {
  /** Annual commitment in the rate card currency. */
  amount: number;
  /** ISO dates (UTC), inclusive start, exclusive end. */
  start: string;
  end: string;
};

export type RateCard = {
  /** ISO 4217 code, e.g. "AUD". Formatted per the user's locale. */
  currency: string;
  /** event.type -> price per rate unit (see Capability.rateUnit). */
  rates: Record<string, number>;
  /** Optional: the commitment for the burn line. */
  commitment: Commitment | null;
  /** Optional: yearly allowance per capability, in its native unit, for usage state. */
  allowances: Record<string, number>;
  savedAt: string;
};

/** Currencies listed first; any other ISO code the browser knows is offered after them. */
export const PREFERRED_CURRENCIES = ["AUD", "SGD", "MYR", "THB", "KRW", "JPY", "USD", "EUR", "GBP", "INR", "IDR", "PHP", "VND", "NZD", "HKD"];

export function currencyOptions(): string[] {
  let all: string[];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency") ?? [];
  } catch {
    all = [];
  }
  return [...PREFERRED_CURRENCIES, ...all.filter((c) => !PREFERRED_CURRENCIES.includes(c))];
}

const isNumberRecord = (v: unknown): v is Record<string, number> =>
  typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0);

function validCard(v: unknown): RateCard | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Partial<RateCard>;
  if (typeof c.currency !== "string" || !/^[A-Z]{3}$/.test(c.currency) || !isNumberRecord(c.rates)) return null;
  const commitment =
    c.commitment &&
    typeof c.commitment.amount === "number" &&
    c.commitment.amount >= 0 &&
    !Number.isNaN(Date.parse(c.commitment.start)) &&
    !Number.isNaN(Date.parse(c.commitment.end)) &&
    Date.parse(c.commitment.end) > Date.parse(c.commitment.start)
      ? c.commitment
      : null;
  return {
    currency: c.currency,
    rates: c.rates,
    commitment,
    allowances: isNumberRecord(c.allowances) ? c.allowances : {},
    savedAt: typeof c.savedAt === "string" ? c.savedAt : new Date(0).toISOString(),
  };
}

/** Version 1 was saved raw under "rate-card-v1": { currency, rates, savedAt }. */
const RATE_CARD: PrefSpec<RateCard | null> = {
  key: "rate-card",
  version: 2,
  defaults: null,
  validate: validCard,
  migrate: (stored: Stored) => (stored.version <= 1 ? validCard({ ...(stored.data as object), commitment: null, allowances: {} }) : null),
  legacyKey: "rate-card-v1",
};

/**
 * Where a rate comes from: rates never require
 * manual entry.
 *   contract  Account Management cost / deduplicated billed usage over closed
 *             UTC days: "Your contract rate (calculated)"
 *   list      Dynatrace public list price: "List price, not your contract"
 *   edited    a manual override for one capability: "Edited"
 * Order: edited, then contract, then list.
 */
export type RateSource = "contract" | "list" | "edited";
export const SOURCE_LABEL: Record<RateSource, string> = {
  contract: LAYER.contract,
  list: LAYER.list,
  edited: LAYER.edited,
};

/** The layer in words inside a sentence that states a money figure (WORDING AND CLAIMS: every figure says its layer). */
export const AT_SOURCE: Record<RateSource, string> = {
  contract: "at your calculated contract rate",
  list: "at list price, not your contract",
  edited: "at your edited rate",
};

/** "about $12.30 at list price, not your contract": a figure with its layer, for sentences. */
export function moneyAt(value: number, currency: string, source: RateSource | undefined): string {
  return source ? `${formatCost(value, currency)} ${AT_SOURCE[source]}` : formatCost(value, currency);
}

export type ContractRates = {
  currency: string;
  rates: Record<string, number>;
  /** Closed UTC days the rates were calculated over. */
  periodStart: string;
  periodEnd: string;
  computedAt: string;
  subscriptionName: string;
  /** What Account Management billed this environment over those days (from v0.12.24; older saves lack it). */
  billed?: ContractBilled;
};

export type ContractBilled = {
  total: number;
  /** Cost for capabilities with no billed usage in this environment: in the total, but in no rate. */
  unmatched: { name: string; value: number }[];
  /** Per closed UTC day (yyyy-mm-dd). */
  byDay: Record<string, number>;
  /** Cost booked on a later day than it was used: the billing report lists it under the booking date (v0.12.25). */
  bookedLater?: number;
};

const CONTRACT: PrefSpec<ContractRates | null> = {
  key: "contract-rates",
  version: 1,
  defaults: null,
  validate: (v) => {
    if (typeof v !== "object" || v === null) return null;
    const c = v as Partial<ContractRates>;
    return typeof c.currency === "string" && isNumberRecord(c.rates) && typeof c.periodStart === "string" && typeof c.periodEnd === "string"
      ? (c as ContractRates)
      : null;
  },
};

export function useContractRates() {
  return usePref(CONTRACT);
}

/**
 * What else Account Management said when rates were last calculated (v0.12.25):
 * budget, forecast, alerts, Dynatrace's own cost-centre split for this
 * environment, and cost for every environment. Saved with the rates, for the
 * saving user only, so screens read it without calling Account Management.
 */
export type AmSnapshot = {
  computedAt: string;
  periodStart: string;
  periodEnd: string;
  budget: AmBudget | null;
  period: AmPeriod | null;
  forecast: AmForecast | null;
  /** Newest first, at most 20. */
  alerts: AmAlert[];
  /** Cost per cost centre over the period; key null is usage with no cost centre. */
  allocation: { key: string | null; cost: number }[] | null;
  allocationComplete: boolean;
  /** Cost per UTC day for every environment in the subscription. */
  accountByDay: Record<string, number> | null;
  accountCurrency: string;
  /** Parts Account Management did not answer, with its reason. */
  missing: { part: string; message: string }[];
};

const AM_SNAPSHOT: PrefSpec<AmSnapshot | null> = {
  key: "am-snapshot",
  version: 1,
  defaults: null,
  validate: (v) => {
    if (typeof v !== "object" || v === null) return null;
    const c = v as Partial<AmSnapshot>;
    return typeof c.computedAt === "string" && typeof c.periodStart === "string" && typeof c.periodEnd === "string" && Array.isArray(c.alerts) && Array.isArray(c.missing)
      ? (c as AmSnapshot)
      : null;
  },
};

export function useAmSnapshot() {
  return usePref(AM_SNAPSHOT);
}

export type EffectiveRate = { value: number; source: RateSource };

export type Rates = {
  /** Currency of every cost shown: the contract currency, else USD (list prices). */
  currency: string;
  rateFor: (eventType: string) => EffectiveRate | null;
  isLoading: boolean;
  card: RateCard | null;
  contract: ContractRates | null;
  /** Edits saved in another currency than the current one are not applied. */
  editsIgnored: boolean;
};

export function useRates(): Rates {
  const { card, isLoading: cardLoading } = useRateCard();
  const { value: contract, isLoading: contractLoading } = useContractRates();
  // An empty or missing contract currency is no contract currency: list prices stay usable.
  const currency = contract?.currency || LIST_PRICE_SOURCE.currency;
  const editsUsable = !card || card.currency === currency;
  const rateFor = (eventType: string): EffectiveRate | null => {
    const edited = editsUsable ? card?.rates[eventType] : undefined;
    if (edited !== undefined) return { value: edited, source: "edited" };
    const fromContract = contract?.rates[eventType];
    if (fromContract !== undefined) return { value: fromContract, source: "contract" };
    if (currency === LIST_PRICE_SOURCE.currency) {
      const list = LIST_PRICES_USD[eventType];
      if (list !== undefined) return { value: list, source: "list" };
    }
    return null;
  };
  return {
    currency,
    rateFor,
    isLoading: cardLoading || contractLoading,
    card,
    contract,
    editsIgnored: Boolean(card && Object.keys(card.rates).length > 0 && !editsUsable),
  };
}

/** One label for a figure built from one or more rate sources. */
export function sourcesLabel(sources: Iterable<RateSource>): string {
  const set = new Set(sources);
  // One readable phrase, not labels glued together (v0.12.20, from a customer's screenshot):
  // the main source first, then what covers the rest.
  const main: RateSource | undefined = set.has("contract") ? "contract" : set.has("list") ? "list" : set.has("edited") ? "edited" : undefined;
  if (!main) return "";
  const rest = (["edited", "list"] as RateSource[]).filter((s) => s !== main && set.has(s));
  if (!rest.length) return SOURCE_LABEL[main];
  const restText = rest.map((s) => (s === "edited" ? "your edited rates" : "list price")).join(" and ");
  return `${SOURCE_LABEL[main]}, with ${restText} for some capabilities`;
}

/** Account Management connection details, stored for this user only. */
export type AmConnection = { accountUuid: string; clientId: string; clientSecret: string; subscriptionUuid: string | null };

const AM: PrefSpec<AmConnection | null> = {
  key: "am-connection",
  version: 1,
  defaults: null,
  validate: (v) => {
    if (typeof v !== "object" || v === null) return null;
    const c = v as Partial<AmConnection>;
    return typeof c.accountUuid === "string" && typeof c.clientId === "string" && typeof c.clientSecret === "string"
      ? { accountUuid: c.accountUuid, clientId: c.clientId, clientSecret: c.clientSecret, subscriptionUuid: c.subscriptionUuid ?? null }
      : null;
  },
};

export function useAmConnection() {
  return usePref(AM);
}

export type RateCardState = {
  card: RateCard | null;
  isLoading: boolean;
  error: string | null;
  save: (card: RateCard) => Promise<void>;
};

export function useRateCard(): RateCardState {
  const { value, isLoading, error, save } = usePref(RATE_CARD);
  return { card: value, isLoading, error, save: (c: RateCard) => save(c) };
}

/** Shown instead of a broken number (NaN or infinity), which would otherwise print as "$NaN". */
export const NOT_A_NUMBER = "not available";

/**
 * A unit rate, with the digits it really has: $0.005, $0.0035, $0.20. Money
 * rounding (formatCost) would show $0.005 as $0.01 and sub-cent rates as "< $0.01".
 */
export function formatRate(value: number, currency: string): string {
  if (!Number.isFinite(value)) return NOT_A_NUMBER;
  try {
    return new Intl.NumberFormat(appLocale(), { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
  } catch {
    return `${value.toLocaleString(appLocale(), { maximumFractionDigits: 6 })} ${currency}`;
  }
}

export function formatCost(value: number, currency: string): string {
  if (!Number.isFinite(value)) return NOT_A_NUMBER;
  // Like quantities: a real but tiny cost must not read as a measured zero.
  if (value > 0 && value < 0.005) return `< ${formatCost(0.01, currency)}`;
  try {
    return new Intl.NumberFormat(appLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: value >= 100 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString(appLocale(), { maximumFractionDigits: 2 })} ${currency}`;
  }
}

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return NOT_A_NUMBER;
  // A real but tiny quantity must not round to a "0" that reads as measured zero.
  if (value > 0 && value < 0.001) return "< 0.001";
  return value.toLocaleString(appLocale(), {
    maximumFractionDigits: value >= 100 ? 0 : value >= 1 ? 1 : 3,
  });
}
