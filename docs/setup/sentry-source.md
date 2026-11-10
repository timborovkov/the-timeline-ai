# Sentry native source

These credentials are separate from `SENTRY_DSN`. Timeline uses Sentry OAuth to read selected Sentry organizations/projects into Timeline; it does not change where Timeline reports its own application errors.

1.  In Sentry, open [Account Settings → API → Applications](https://sentry.io/settings/account/api/applications/) and create an OAuth application for Timeline.

2.  Add the redirect URI: `https://thetimeline.cc/api/integrations/sentry/callback`.

3.  Sentry OAuth scopes are requested by Timeline in the authorize URL; the app page may not have a separate scope picker. Timeline requests `org:read`, `project:read`, `event:read`, `event:admin`, and `team:read`.

4.  Use a confidential/server-side OAuth app that exposes a client secret. If the page says *Public Client* and only shows a client id, that PKCE-only app is not compatible with the current Timeline provider until the Sentry adapter adds PKCE support.

5.  Copy the **Client ID** and **Client Secret**. Authorized JavaScript origins are not used by Timeline's server-side callback flow.

6.  Set:

        SENTRY_INTEGRATION_CLIENT_ID=...
        SENTRY_INTEGRATION_CLIENT_SECRET=...

7.  Connect Sentry from the native catalog, share selected projects from `/app/me/connections`, and activate them from `/app/connections/sources`. Timeline imports issue lifecycle changes (open / resolved / ignored) and releases as cited events; Sentry issues map to cited incident evidence. Dedup keys are issue-plus-lifecycle (not `lastSeen`), so repeated error occurrences and noisy issue-alert timestamps reuse the same raw event instead of minting a new embed job on every bump. Sentry issues stamp `signalClass=finding` and skip extract; they attach to the parent hub and do not mint sibling Timeline tasks.

8.  For Sentry issue alert, issue lifecycle, and release webhooks, point the Sentry integration webhook URL at `https://thetimeline.cc/api/webhooks/sentry`. Timeline verifies `Sentry-Hook-Signature` with `SENTRY_INTEGRATION_CLIENT_SECRET`, persists the delivery, and lets `webhook-delivery` process direct events or targeted reconciliation for the selected organization/project targets. Alert `triggered` deliveries for an already-open issue coalesce onto the same open dedup key; reconciliation can still refresh incident evidence without another LLM pass.

<span id="native-ownership"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
