# Install License Consumption Explorer in your Dynatrace environment

_The easiest way to follow this is **START-HERE.html** (open it in your browser): the same steps with Mac and Windows tabs and copy buttons. This file is the plain-text version._

For the environment's admin. About 15 minutes. You install it with your own credentials; nobody else needs them.

## Before you start

| You need | Where |
|---|---|
| A Dynatrace Platform Subscription (DPS) environment | Older licence models write no billing usage events, so the app would show nothing. |
| This project folder | From the person who sent you this. Nothing needs installing on your computer: the installer uses `curl` (macOS, Linux) or PowerShell (Windows), which come with the system. |
| An OAuth client that can install apps | Account Management > Identity & access management > OAuth clients > Create client, with the scopes `app-engine:apps:install`, `app-engine:apps:run`, `app-engine:apps:delete` |

Your own user needs the **AppEngine developer** and **AppEngine user** policies. Everyone who will use the app needs the **Read System Events** policy (billing records live in system events) and read access to entities (for host, namespace and application names).

**Recommended:** install in a non-production environment first.

## Install the easy way

Inside the project folder, run the install script. It asks for the environment address and the OAuth client (the secret is hidden as you type and saved nowhere), signs in, and uploads the ready-built app in `package/` to Dynatrace. It takes under a minute.

macOS / Linux:

```bash
bash install.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Install by hand

The installer does two things, which you can also do yourself with `curl`. First get a token (put your own client ID and secret in):

```bash
curl -sS -X POST https://sso.dynatrace.com/sso/oauth2/token \
  -d grant_type=client_credentials \
  -d client_id=dt0s02.YOURCLIENTID \
  --data-urlencode client_secret=dt0s02.YOURCLIENTID.YOURSECRET \
  -d scope=app-engine:apps:install
```

Then upload the app with the `access_token` from the answer:

```bash
curl -sS -X POST https://YOUR-ENVIRONMENT.apps.dynatrace.com/platform/app-engine/registry/v1/apps \
  -H "Authorization: Bearer THE_ACCESS_TOKEN" \
  -H "content-type: application/zip" \
  --data-binary @package/app-vX.Y.Z.zip
```

An answer of `{"id":"my.license.consumption.explorer"}` means it was accepted; Dynatrace finishes installing within a minute.

The app's address is `https://YOUR-ENVIRONMENT.apps.dynatrace.com/ui/apps/my.license.consumption.explorer`.

On first open, Dynatrace asks to approve the app's permissions (listed in SECURITY-SUMMARY.md). All of them are read-only on your environment, except saving each user's own settings.

## Build from source (developers only)

The ready-built app in `package/` is all an install needs. To rebuild it from the source, you need Node.js 20 or newer: `npm ci`, then `npm run package` writes a new package to `out/artifact.zip`.

## After install: first-run check (5 minutes)

1. Open the app. The Overview should say how many types of usage were billed in the last 30 days.
2. If it says it can't read system events, the user lacks the Read System Events policy.
3. If names show as IDs, the user lacks read access to entities.
4. Then go through FIRST-RUN-CHECK.md.

## Update to a newer version

For anyone who already installed the app. About three minutes; everyone keeps their saved settings (ownership rules, budgets, edited rates, the Account Management connection, dismissed tips).

1. Unzip the new version anywhere. The old folder can be deleted.
2. Open a terminal in the new folder, as for the first install.
3. Run the installer with the same environment address and the **same OAuth client** as the first time. No new client is needed; if the secret is lost, create a new client as for the first install.
4. Open the app, reload, and open **Help** (top right): the last line shows the installed version. If Dynatrace asks to approve permissions again, the new version uses one more read-only permission.

Each version has a new number; Dynatrace refuses a version number it has already seen with different contents.

## Remove

With a token from an OAuth client that has the scope `app-engine:apps:delete` (requested as in "Install by hand", with that scope):

```bash
curl -sS -X DELETE https://YOUR-ENVIRONMENT.apps.dynatrace.com/platform/app-engine/registry/v1/apps/my.license.consumption.explorer \
  -H "Authorization: Bearer THE_ACCESS_TOKEN"
```

Users' saved settings (rate-card edits, ownership rules, budgets, any Account Management connection) are stored per user in app state and go with the app.

## If the install fails

| Message | Meaning |
|---|---|
| "Sign-in failed" | The client ID or secret is wrong, or the client lacks `app-engine:apps:install`. |
| 401 / 403 on the upload | The OAuth client lacks `app-engine:apps:install`, or your user lacks the AppEngine developer policy. |
| "same version is already installed with a different checksum" | That version number was already installed. Ask for a build with a new version number. |
| Custom apps not allowed | Your environment restricts custom apps; your Dynatrace admin or account team can say how to allow them. |
