/**
 * Dynatrace public list prices, used when no Account Management connection
 * gives a contract rate. Every figure computed from these is labelled
 * "List price, not your contract".
 *
 * Source: https://www.dynatrace.com/pricing/rate-card/ ("List Price (USD)",
 * page dateModified 2026-06-17), read 2026-10-08. Each value is per the
 * capability's rate unit in capabilities.ts (the card's units match, except
 * that metrics are per 100,000 data points on both sides).
 * Not published, so absent here: Digital Experience Monitoring - Query.
 * Name mismatch: the card's "Standard Function Calls" is mapped to
 * "AppEngine Functions - Small" (NOT VERIFIED to be the same line).
 */
/**
 * Capabilities Dynatrace does not charge for yet, with its own wording (Preview
 * program page, https://docs.dynatrace.com/docs/whats-new/preview-releases,
 * updated 2026-10-07): DEM Query is Early Access, DEM extended retention is a
 * Preview. Their billing records can still carry bytes (the development environment: ~150 GiB of
 * DEM Query in 30 days), so they are labelled, never priced. Re-check each release.
 */
export const NOT_CHARGED: Record<string, string> = {
  "Digital Experience Monitoring - Query": "not charged yet (Early Access)",
  "Digital Experience Monitoring - Retain": "not charged yet (Preview)",
};
/** Short names for sentences. */
export const NOT_CHARGED_NAME: Record<string, string> = {
  "Digital Experience Monitoring - Query": "DEM Query",
  "Digital Experience Monitoring - Retain": "DEM extended retention",
};
/** Where Dynatrace says so: linked from the wording instead of quoting dates on screen. */
export const NOT_CHARGED_URL = "https://docs.dynatrace.com/docs/whats-new/preview-releases";

export const LIST_PRICE_SOURCE = {
  url: "https://www.dynatrace.com/pricing/rate-card/",
  currency: "USD",
  pageModified: "2026-06-17",
  retrieved: "2026-10-08",
};

export const LIST_PRICES_USD: Record<string, number> = {
  "Full-Stack Monitoring": 0.01,
  "Infrastructure Monitoring": 0.04,
  "Foundation & Discovery": 0.01,
  "Database Monitoring": 0.11,
  "Kubernetes Platform Monitoring": 0.002,
  "Code Monitoring": 0.005,
  "Runtime Vulnerability Analytics": 0.00225,
  "Runtime Application Protection": 0.00225,
  "Security Posture Management": 0.007,
  "Real User Monitoring": 0.00225,
  "Real User Monitoring with Session Replay": 0.0045,
  "Real User Monitoring Property": 0.0001,
  "Browser Monitor or Clickpath": 0.0045,
  "HTTP Monitor": 0.001,
  "Third-Party Synthetic API Ingestion": 0.001,
  "Mainframe Monitoring": 0.1,
  "Log Management & Analytics - Ingest & Process": 0.2,
  "Log Management & Analytics - Retain": 0.0007,
  "Log Management & Analytics - Query": 0.0035,
  "Log Management & Analytics - Retain with Included Queries": 0.02,
  "Events - Ingest & Process": 0.2,
  "Events - Retain": 0.0007,
  "Events - Query": 0.0035,
  "Traces - Ingest & Process": 0.2,
  "Traces - Retain": 0.0007,
  "Traces - Query": 0.0035,
  "Metrics - Ingest & Process": 0.15,
  "Metrics - Retain": 0.0007,
  "Automation Workflow": 0.03,
  "AppEngine Functions - Small": 0.001,
  "AI Units": 0.1,
};
