# GitHub

GitHub is a native Timeline integration. It is optional for non-engineering teams, but when connected it receives the same first-party treatment as Linear and Google Drive: person-owned OAuth, team source selection, audit rows, encrypted tokens, worker sync, and cited timeline events. Synced external work items can also map to task objects; visible task titles stay human-facing while provider IDs, issue keys, numbers, and URLs stay in integration metadata, aliases, or evidence. Envelope `signalClass` decides extract vs parse: merged PRs and closed issues are captured work and skip the models; workflow runs are pulses; review comments are findings. Timeline `event_class` is the inspector family and does not decide that skip. Merged PRs and closed issues enqueue a coalesced, approval-backed Timeline task update keyed by `repo#number`, not by nearby unrelated events.

1.  Create a GitHub App at [github.com/settings/apps](https://github.com/settings/apps). For an organization-owned app, use the organization's **Settings → Developer settings** page instead. Timeline still uses the app's OAuth web flow for the connecting user, then mints installation access tokens for repository syncs when `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are configured.

2.  Callback URL: `https://thetimeline.cc/api/integrations/github/callback`.

3.  Timeline requests scopes in the OAuth authorize URL, so there is no separate scope picker in GitHub's app settings. The requested scopes are `repo` and `read:org`.

4.  Grant repository read permissions for Contents, Issues, Pull requests, Actions, and Metadata. Missing Pull requests read access records a PR-surface partial sync on the `/pulls` endpoint while commits, issues, releases, and workflow runs continue to sync when readable. Timeline keeps the connection attention visible until that partial failure clears, so admins can reconnect or re-grant access without losing the other GitHub surfaces. HTTP 401, 403, and 404, plus removed-installation or deleted-repo errors, count as access revoked: Timeline surfaces that immediately and pauses the integration after the sustained-failure window. Keep both Issues and Pull requests read access: Timeline captures ordinary issue comments, PR conversation comments, review summaries, and inline review comments.

5.  Copy the app **Client ID**, generate/copy a **Client secret**, copy the numeric **App ID**, and generate a private key. Store the PEM as a multiline secret or with literal `\n` escapes.

6.  Set:

        GITHUB_APP_CLIENT_ID=...
        GITHUB_APP_CLIENT_SECRET=...
        GITHUB_APP_ID=...
        GITHUB_APP_PRIVATE_KEY=...
        GITHUB_WEBHOOK_SECRET=...

7.  Configure the GitHub webhook URL as `https://thetimeline.cc/api/webhooks/github` and use the same `GITHUB_WEBHOOK_SECRET` as the webhook secret. Timeline verifies `X-Hub-Signature-256`, stores `X-GitHub-Delivery`, and routes selected repo/org deliveries through `webhook-delivery`.

8.  Subscribe the GitHub App webhook to `push`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issues`, `issue_comment`, `release`, and `workflow_run`. Timeline still reconciles selected repos slowly, but these events carry normal day-to-day activity and review conversation without waiting for the reconciliation tick.

9.  Any team member can connect GitHub from `/app/me/connections` or the native catalog. The member then chooses which repos or organizations are shared with the current Timeline team.

10. A team admin activates shared sources from `/app/connections/sources`. A GitHub organization scope means all repos in that org the connection owner can access, including future repos; choose individual repos instead for a fixed list.

11. Selected GitHub sources still use slow reconciliation through the integration worker, but normal PR, issue, release, workflow, and push activity can arrive through signed webhooks first. When installation-token config is present, repo hydration uses the GitHub App installation quota instead of spending the connecting user's OAuth token quota. Issue, PR, workflow-run, and release dedup keys are lifecycle-stable (not `updated_at`), so title/body edits reuse the same raw event; commits still key by SHA and review/comment events keep their existing identity rules.

<span id="monday"></span>

Shared prerequisites, health and resync: [integrations](integrations.md).
