# First-run check

A short check after installing, so you can trust the numbers in your environment. Each step compares the app with something you already rely on. If anything looks off, fill in the table at the bottom and send it back with screenshots, and it will be tuned to your environment.

Use the **last 30 days** unless a check says otherwise. Note your environment's rough size (hosts, namespaces) at the top of the feedback.

## A. It loads and reads your data
1. **Overview** opens without an error and says "N types of usage were billed in the last 30 days".
2. Every screen in the sidebar opens (Consumption: Overview, Usage, Entities with its five tabs, Ownership; Cost: Spend, Cost per host, Fix list, Team budgets, Reconcile; Shared: Rate card, Queries, Glossary, Diagnostics). Note any screen that shows an error, stays loading for more than 30 seconds, or says "Figures may be incomplete".

## B. Numbers match what you trust
3. **Usage:** pick two capabilities you know well (for example Full-Stack Monitoring and Log ingest). Compare the 30-day totals with **Account Management > Subscription > usage**. Small differences are expected (records still arriving); note any difference over 5%.
4. **Entities > Hosts:** do the top hosts look right to you? Spot-check one host's GiB-hours against its memory size × hours running.
5. **Spend:** the total is at **public list prices** unless you connect Account Management. Is it in the right range compared with your actual Dynatrace cost? (It should be higher or lower in proportion to your discount.)

## C. Cost Allocation (the main thing this environment can prove)
6. If you use Cost Allocation: on the **Overview**, does "Charged to a team" count the capabilities you allocate? Compare with your Cost Allocation report or dashboard.
7. **Entities > Hosts:** filter "Cost tag: Has a cost tag". Do the hosts you've tagged appear? Open one: does it name the right cost centre?
8. **Ownership** and **Team budgets:** do your cost centres appear as owners with sensible costs?
9. **Fix list > Hosts and namespaces without a cost centre:** is the list believable?

## D. Fix list
10. For each lever marked **Worth reviewing**, is the finding true? (For example: are the "workflows billed with no runs" really idle in your environment?) Note anything that is wrong or misleading.

## E. Preview features (only if you choose to try them)
11. **Rate card > Connect Account Management:** needs an OAuth client at your **account** level with only "View usage and consumption". Test connection, Save connection, Calculate contract rates. Do the calculated rates look like your contract prices?
12. **Reconcile > Compare now:** which capabilities say "Matches", and which don't?

## F. Speed and feel
13. Roughly how long does each screen take to load? Anything that feels slow, confusing or wrong?

---

## Feedback (copy, fill in and send back)

Environment size: about ___ hosts, ___ namespaces. Uses Cost Allocation: yes / no. Account Management connected: yes / no.

| Check | Result (OK / wrong / error / skipped) | What you saw (numbers, screenshot name) |
|---|---|---|
| A1 | | |
| A2 | | |
| B3 | | |
| B4 | | |
| B5 | | |
| C6 | | |
| C7 | | |
| C8 | | |
| C9 | | |
| D10 | | |
| E11 | | |
| E12 | | |
| F13 | | |

Anything else:
