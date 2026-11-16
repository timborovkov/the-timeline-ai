# Linear

Timeline uses Linear OAuth plus an optional signed webhook. OAuth grants the connection owner read access; the team only activates Linear teams that owner shares.

1.  Create an OAuth application at [linear.app/settings/api/applications](https://linear.app/settings/api/applications).

2.  Redirect URI: `https://thetimeline.cc/api/integrations/linear/callback`.

3.  Grant the OAuth app the `read` scope.

4.  Copy the OAuth client id and client secret from the Linear application page.

5.  Set:

        LINEAR_CLIENT_ID=...
        LINEAR_CLIENT_SECRET=...
        LINEAR_WEBHOOK_SECRET=...

6.  In Linear Settings → API → Webhooks, point the webhook at `https://thetimeline.cc/api/webhooks/linear` with the secret above.

7.  Any team member can connect Linear from `/app/me/connections` or the native catalog. The member chooses which Linear teams are shared with the current Timeline team.

8.  A team admin activates shared Linear teams from `/app/connections/sources`. Issue and project dedup keys are lifecycle-stable (status/state, not `updatedAt`), and comments key by id, so description or timestamp churn reuses the same raw event instead of minting another embed job. Envelope `signalClass` decides extract vs parse: Linear issues are captured work; comments are findings. Timeline `event_class` is presentation only and does not skip extract.

<span id="github"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
