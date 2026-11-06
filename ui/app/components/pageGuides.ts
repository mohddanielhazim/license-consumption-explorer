import type { Guide } from "./Info";

/**
 * What each screen is for (v0.12.8): the (i) beside the screen name in the
 * header. One question per screen and when to open it, so nobody needs to be
 * taught the app. Keyed by the header label (routes.sectionFor).
 */
export const PAGE_GUIDES: Record<string, Guide> = {
  Home: {
    what: "The whole picture on one screen: what this timeframe costs, what changed, how much can be charged to teams, and what is worth reviewing.",
    when: "Start here. Each card opens the screen with the detail.",
  },
  Overview: {
    what: "How much of your Dynatrace usage can be charged to a team, in four checks. Each capability passes them in order and stops at the first it fails. Used: billed in the timeframe. Traceable: the records name a host, namespace, app, person or cost centre. Owned: they carry a real cost centre, or name a person. Charged to a team: they would appear under a team in the Cost Allocation export.",
    why: "Usage that stops before the last check can't be charged to a team yet.",
    how: "Read from each billing record's own fields: what it names, its cost centre, and whether the Cost Allocation export includes that capability.",
    where: "Billing usage events in Grail (dt.system.events, BILLING_USAGE_EVENT); entity fields dt.entity.* and dt.smartscape.*; cost centre dt.cost.costcenter.",
    who: "Platform owners act on Traceable and Owned; finance on Charged to a team.",
    when: "When you are setting up Cost Allocation, or want to see why some usage doesn't reach a team. Services and processes are not billed, so they never appear here.",
  },
  Usage: {
    what: "Everything billed in the timeframe, capability by capability, each in its own unit, with a daily chart.",
    when: "When you want to see what you use and spot a spike on a particular day.",
  },
  Entities: {
    what: "Which hosts, Kubernetes namespaces, applications, synthetic monitors and buckets use the most, in units.",
    when: "When you want to know which things drive a capability's usage. Download the list to send to the teams who run them.",
  },
  Ownership: {
    what: "Which hosts and namespaces have an owner, and which don't. Owners come from Dynatrace cost centres or from simple rules you add here.",
    when: "Before charging cost to teams: give everything an owner. The download lists every host and namespace with its owner.",
  },
  Spend: {
    what: "What this timeframe costs, per day and per capability, with tabs for commitment burn, usage against plan, why it moved and what if.",
    when: "When finance asks what Dynatrace costs, why the cost changed, or what a change in usage would do.",
  },
  "Cost per host": {
    what: "Which hosts cost the most, with every capability billed on each host added up.",
    when: "When you want a machine's estimated cost with every capability added up.",
  },
  "Findings": {
    what: "Checks on usage that may be worth reviewing, each with what was found, how to change it and the trade-off. For review only: this app changes nothing.",
    when: "When you want to review usage that may not be needed. Open a check to see the details.",
  },
  "Team budgets": {
    what: "Cost per owner in the timeframe, against a budget per 30 days you set for each.",
    when: "When teams own their Dynatrace spend. Needs owners first, from the Ownership screen.",
  },
  Reconcile: {
    what: "Compares Account Management's usage with what this app counts, and explains any gap.",
    when: "When you want to check the app's counts against Account Management's own usage figures. Needs the Account Management connection.",
  },
  "Rate card": {
    what: "Which prices the app uses: public list prices by default, your contract rates once Account Management is connected, or your own overrides.",
    when: "To see which rate a figure uses, or to add a commitment for the burn line.",
  },
  Queries: {
    what: "Who and what runs the queries you pay for: apps, dashboards and service accounts. By source pools people; By person shows a code per person, and names only when you choose Show names.",
    when: "When you want to see where query cost comes from.",
  },
  Glossary: {
    what: "What the words on these screens mean.",
    when: "Whenever a term is unclear.",
  },
  Diagnostics: {
    what: "Raw billing records and ready-made queries, to check a number yourself.",
    when: "When you want to check a number yourself.",
  },
};
