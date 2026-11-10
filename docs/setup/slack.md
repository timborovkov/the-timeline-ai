# Slack conversations and capture setup

Slack is a first-party conversational surface like Telegram: direct text talks to the agent, files and explicit notes are captured, and channels stay ingestion-first unless someone invokes `/ask` or `@Timeline`. OAuth-proven identities can select only Timeline memberships enabled for that Slack workspace.

<span id="app"></span>

## 1. Create the Slack app

1.  Create an app at [api.slack.com/apps](https://api.slack.com/apps).
2.  Copy the app's client id, client secret, and signing secret.

<!-- -->

    SLACK_CLIENT_ID=
    SLACK_CLIENT_SECRET=
    SLACK_SIGNING_SECRET=

Slack bot tokens are stored encrypted at rest with `SECRETS_ENCRYPTION_KEY`. Generate that key before installing Slack.

<span id="urls"></span>

## 2. Configure URLs

- OAuth redirect URLs: `https://thetimeline.cc/api/slack/install/callback` and `https://thetimeline.cc/api/slack/user-link/callback`. Add `https://thetimeline.cc/api/integrations/slack/callback` when enabling native workspace ingestion.
- Events Request URL: `https://thetimeline.cc/api/slack/events`.
- Interactivity Request URL: `https://thetimeline.cc/api/slack/interactions`.
- Slash Commands → Create New Command for timeline questions:
  - Command: `/ask`
  - Request URL: `https://thetimeline.cc/api/slack/commands`
  - Short description: `Ask the Timeline AI`
  - Usage hint: `[question]`
  - Answers use the shared external-chat profile: concise plain text by default, with no raw Timeline citation ids, Markdown markers, or source footer. An explicit request for a full breakdown can expand within the external reply limit; use web chat for rich, clickable evidence links.
  - Leave **Escape channels, users, and links sent to your app** unchecked. Timeline treats the command text as a natural-language question, so readable `@user` and `#channel` text is more useful than Slack IDs.
- Slash Commands → Create New Command for meeting capture:
  - Command: `/timeline`
  - Request URL: `https://thetimeline.cc/api/slack/commands`
  - Short description: `Control Timeline capture`
  - Usage hint: `note|new|team|whereami|help|join`
  - Saved Meeting aliases join immediately. Raw URLs send an ephemeral confirmation with **Confirm and join** and **Cancel** buttons before any bot is created.

The events, slash-command, and interaction endpoints verify Slack's `X-Slack-Signature` and reject timestamps older than five minutes.

Slack's `/` picker is the workspace slash-command list, not a Telegram-style bot menu. After the two commands above exist on the Slack app, `/ask` and `/timeline` appear when someone types `/`. Nested actions such as `note`, `new`, and `help` are arguments to `/timeline`, so they will not show as their own slash commands. There is no runtime `setMyCommands` equivalent; adding or renaming slash commands is Slack app configuration.

<span id="scopes"></span>

## 3. Add scopes and events

Bot scopes used by conversational capture:

    app_mentions:read
    channels:history channels:read
    chat:write commands files:read
    groups:history groups:read
    im:history im:read im:write
    reactions:write users:read users:read.email

Native workspace ingestion also needs `reactions:read` so synced channel history can include reactions.

User scope used for identity linking:

    identity.basic

Subscribe to bot events:

    message.channels
    message.groups
    message.im
    app_mention

<span id="install"></span>

## 4. Install and bind conversations

1.  Open **Connections → Slack** in Timeline.
2.  Team owner/admin installs or reconnects the Slack app.
3.  Members can click **Connect identity** to link their Slack user. Linking is required for DMs and user-scoped actions; bound channels can still answer `/ask` and `@Timeline` for unlinked senders using team-visible history.
4.  Owner/admin chooses channels/private channels from the picker and binds them.

The bot must be present in a private channel before Slack will deliver history/events for it. DMs need no channel binding; they route through the linked Slack user's active team. Daily digest delivery uses the same bot token: a workspace can post the team-visible digest to a channel the bot is in, or DM every linked member. Add `im:write` so the bot can open those DMs. Configure destinations in Team settings → Preferences.

In a DM, ordinary text and `/ask <question>` create durable agent turns. `/timeline note <text>` captures evidence, `/timeline new` resets private history, `/timeline team` lists eligible teams, `/timeline team <number>` switches and resets history, `/timeline whereami` shows the route, and `/timeline help` prints the command guide. Messages with files always ingest, including their captions.

Direct turns react with `:thinking_face:` while the `conversation-agent` worker runs. Notes and file captures react with `:eyes:`. The webhook persists and enqueues the turn before returning; the worker has a 180-second deadline and posts the final answer as a normal DM. Profile refreshes and reaction delivery do not delay the webhook response after that durable enqueue. Installed workspace tokens remain encrypted in Postgres and are decrypted only when the worker reconstructs the delivery adapter. Slack AI Assistant status is optional and is not required for classic DMs or the scope list above.

<span id="live-canary"></span>

## 5. Live canary

`bun run canary:integrations` already checks the Slack OAuth authorize endpoint and signing-secret configuration. To also prove provider-backed Slack Web API access, set one or both optional canary tokens:

    SLACK_CANARY_BOT_TOKEN=xoxb-...
    SLACK_CANARY_USER_TOKEN=xoxp-...

The canary only calls Slack's read-only `auth.test` endpoint and redacts tokens from output. These env vars are not used by the product runtime; real installed workspace bot and user tokens remain encrypted in the database through the normal OAuth flow.

To prove end-to-end capture for an installed workspace without posting into Slack, configure the signed event capture canary:

    SLACK_CAPTURE_CANARY_TEAM_ID=T...
    SLACK_CAPTURE_CANARY_CHANNEL_ID=C...
    SLACK_CAPTURE_CANARY_USER_ID=U...
    SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN=https://thetimeline.cc

The canary signs a synthetic Slack `event_callback` message with `SLACK_SIGNING_SECRET`, posts it to `AUTH_URL/api/slack/events`, then polls the configured `DATABASE_URL` for a matching `raw_events.source='slack'` row. The Slack team must already be installed in the same database, the channel must be bound to a Timeline team, and the user ID must be valid for that Slack workspace so the normal `users.info` path succeeds.

<span id="native-ingestion"></span>

## Native workspace ingestion

See [native source setup](slack-source.md); this guide owns conversation/reliability setup.


## Mental model

- **Sender** is always recorded in metadata and rendered into extraction and embeddings, whether or not that Slack user is linked to a Timeline user.
- **Source owner** for a bound channel is the Timeline user who created the binding. Unlinked sender messages use that owner for source ownership and default visibility ownership, but they are not attributed as authored by the binding owner.
- Linked Slack senders are authors for their own messages when they are members of the receiving Timeline team.
- In bound channels, `/ask` and `@Timeline` can answer for unlinked Slack senders through a team-scoped bot actor. That actor sees team-visible history but not private or specific-user events. It may use enabled team-shared custom MCP tools and create new team-visible approval proposals, but cannot revise/approve proposals, use personal tools, or mutate canonical Timeline state. Enabled team-shared custom MCP tools can still cause external side effects. Linked members retain normal member-level behavior, and unlinked direct messages remain blocked.
- Text-bearing Slack captures enqueue extraction, embeddings, and approval-suggestion work directly. Shared URLs in the text are normalized into non-authoritative artifact evidence so timeline grouping can surface the link context without letting the link change canonical state. Emails, phone numbers, and conservative labeled addresses are recorded on `source_metadata.contacts`; accepted email/phone memory still goes through person identity facets rather than standalone artifacts. File-only messages create captured files for source evidence and route those files to extraction without inventing approval suggestions before text or transcripts exist.
- Slack direct agent turns get a best-effort `:thinking_face:` reaction. Explicit notes and file captures get `:eyes:`. Channels never get capture acknowledgement reactions.
- An eligible Slack DM team must be both an active Timeline membership and enabled for the current Slack workspace. Old `slack_user_teams` routing rows never expand that boundary.
- `/timeline join` is the only Slack text path that starts meeting capture. Ordinary messages such as "everyone join daily" are treated as normal conversation and never invite a bot.
- Source edits create replacement raw rows and tombstone older visible revisions. Source deletes tombstone active Timeline rows while preserving immutable raw rows.
- Voice-memo style audio is transcribed. Supported text, image, PDF, DOCX, CSV/JSON/XML/YAML, Markdown, HTML, and log files become captured files that feed typed extraction representations and embeddings. Archives, executables, video, oversize files, and unknown binary files are skipped. Ambiguous `.mp4`/`.webm` files require an `audio/*` content type to enter transcription.
