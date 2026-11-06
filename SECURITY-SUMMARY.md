# Security summary: License Consumption Explorer

One page for a security or change review. Version 0.12.50. A custom Dynatrace app: it runs on Dynatrace's own app platform (AppEngine) under Dynatrace's permission model. It is not a Dynatrace-supported product; support comes from its author, Mohd Daniel Hazim Amran.

## What it does
Reads the environment's own billing usage records and shows which hosts, Kubernetes namespaces, applications, monitors, buckets and workflows consume the Dynatrace Platform Subscription, in units and (at public list prices or a calculated contract rate) in money. It changes nothing in Dynatrace.

## Permissions it asks for

| Scope | Read or write | Why |
|---|---|---|
| `storage:system:read` | read | billing usage events, query and workflow events in `dt.system.events` |
| `storage:buckets:read` | read | the bucket that holds system events |
| `storage:entities:read` | read | names of hosts, namespaces, applications and monitors |
| `storage:smartscape:read` | read | the same names on newer environments, which have Smartscape instead of the classic entity tables |
| `state:user-app-states:read` | read | the user's own saved settings |
| `state:user-app-states:write` | write, **per user only** | saving those settings, only when the user chooses Save |

No scope writes environment configuration, settings, entities, data or other users' state. Each user still needs their own Dynatrace permissions to see anything: the app cannot read more than the user can.

## What it stores, and where
Only in each user's own app state, only after that user saves: rate-card overrides, an optional commitment and allowances, ownership rules, team budgets, dismissed tips, whether keyboard shortcuts are on, and **optionally** an Account Management connection (account ID, OAuth client ID and client secret). Nothing is stored anywhere else (the optional first-look checklist remembers its progress in the browser only). Uninstalling the app removes it.

## Where data goes
Nowhere outside the environment, with one optional exception: if a user saves an Account Management connection, the app's server-side function calls Dynatrace's own `sso.dynatrace.com` (token) and `api.dynatrace.com` (subscription and budget, cost and usage, forecast, cost alerts and the cost allocation report, all read-only under the scope `account-uac-read`). No third party, no telemetry, no analytics, no external fonts or scripts (fonts are bundled).

## Personal data
- User email addresses are never stored or logged, and are not shown unless the viewer asks. On the Queries screen they are used inside the query to tell service accounts from people, and removed before results leave Grail.
- **By source** (the default) pools people per app and hides groups of fewer than five. **By person** shows a stable code per person (a hash of the user ID), never a name or email.
- In By person, **Show names** re-runs the query with the email included, for that visit only. The choice is kept in memory, not in the URL, settings or logs, so a shared link or a reload shows codes again. Viewers only see users whose query records their own Dynatrace permissions already let them read.

## Points a reviewer should know
- **Account Management secret:** stored in the saving user's own app state and downloaded to that user's browser when the connection is used, then sent to the app's function. Moving it to an admin-held secret would need app-settings permissions. **Teams that prefer not to store it can simply not connect:** the app then uses public list prices, labelled on every figure.
- **Preview features:** the Account Management connection, Reconcile, the commitment burn line and usage against plan have not yet run against a live subscription and are labelled "Preview" on screen.
- **Function input:** validated (strict UUIDs, plain environment IDs, known actions); upstream calls have 15-second timeouts; malformed replies return a message rather than failing.
- **Testing:** `npm test` (40 automated tests: calculations, the one time base for every query, queries in the real query engine on test records, the Account Management function against simulated replies, screens including 1,000 and 5,000 hosts and 30 clusters), plus contrast and interaction checks. Not yet proven on a live tenant: an allow-listed cost centre end to end, and the Account Management connection (hence the Preview labels).
