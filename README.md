# License Consumption Explorer

A custom Dynatrace app that shows where your Dynatrace Platform Subscription goes: which hosts, Kubernetes namespaces, applications, synthetic monitors, buckets and workflows consume it, how much of it can be charged back to teams, and what is worth reviewing to spend less. It reads your environment's own billing records and changes nothing in Dynatrace.

Built by **Mohd Daniel Hazim Amran**. Not an official Dynatrace product; questions and feedback go to the author.

**Version:** see `app.config.json`. Features marked "Preview" on screen (the Account Management connection, Reconcile, the commitment burn line and usage against plan) are newer and optional; everything else is the core of the app.

## Start here

**Open `START-HERE.html`** in your browser (double-click it). It is the whole guide on one page: what the app does, how to install it on Mac or Windows with commands you can copy, giving your team access, and what to do if something goes wrong.

Also in this folder:
- **SECURITY-SUMMARY.md**: one page on permissions, what it stores and where data goes, for a security or change review.
- **FIRST-RUN-CHECK.md**: a short check after installing, so you can trust the numbers in your environment.
- **INSTALL.md**: the same install steps as plain text.
- `package/`: a ready-built install package (the same app) for change processes that want a file.

## Two workspaces

- **Consumption** (units): Overview of how much usage can be charged to teams, Usage per capability, Entities (hosts, Kubernetes, applications, synthetic monitors, buckets), Ownership.
- **Cost** (money, at public list prices unless Account Management is connected): Spend, Cost per host, Findings, Team budgets, Rate card (with Reconcile).

## For developers

- `npm ci`, then `npm run start` to run locally (set your own environment in `app.config.json` first).
- `npm run package` builds an installable package into `out/`.
