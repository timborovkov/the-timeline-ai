# Integration surfaces

Choose a surface by what people should be able to do in Timeline. One service can support several workflows. For example, a Slack DM is a conversation with the agent, while a selected Slack channel can be a source of searchable history.

| What the team wants | Surface | Where the result appears | Setup |
| --- | --- | --- | --- |
| Ask a question in chat or save a message | Chat and capture | Answers return to the conversation. Captured messages, notes and supported files become timeline evidence. | [Telegram bot](setup/telegram.md) · [Slack conversations](setup/slack.md) |
| Keep a task status or a deal card’s lane in sync | Structured board import | A confirmed rule creates or links records on a chosen board. The card shows which source controls the field. | [GitHub repositories](setup/github.md#import-repository-work-into-a-board) · [Linear teams](setup/linear.md#import-issues-into-a-board) · [HubSpot pipelines](setup/hubspot.md#import-into-a-board) |
| Make external activity searchable or available for proposals | Evidence capture | Events appear on the timeline. Processing depends on the signal. Text can support extraction and approval-backed proposals. | [Generic ingest webhook](setup/ingest-webhooks.md) · [monday.com boards and WorkDocs](setup/monday.md) · [Slack channel history](setup/slack-source.md) |

Unstructured notes and arbitrary webhook bodies fit the evidence-capture path. **Native** describes how Timeline connects to a service. A native connector can capture evidence without offering a board import. For example, monday.com understands board items, updates and WorkDocs, but selecting a monday.com board does not give its status column control over a Timeline lane. Likewise, an app can send perfectly structured deal JSON to a generic webhook and get searchable evidence. A webhook’s **Timeline type** controls how that evidence appears. [Processing rights](relational-memory.md#processing-rights) · [Webhook authority](adr/0009-ingest-webhooks-are-evidence-only.md)

## Configure a surface

- **Chat.** An operator configures the bot and its HTTPS callbacks. Members link their identities for direct conversations. Bind a group or channel to the intended team for shared capture. To check the setup, ask a question in a linked DM, then save a distinct test note and find it on the timeline. For passive Slack history, share and activate the channel through the native source picker. [Telegram setup](setup/telegram.md) · [Slack setup](setup/slack.md) · [Slack workspace ingestion](setup/slack-source.md)
- **Board import.** A member connects their provider account and shares a GitHub repository, Linear team, or HubSpot pipeline. An admin activates the source under **Connections → Sources**. Once it has captured records, the admin can preview matches and authorize one-way updates for a destination board. [Board import walkthrough](setup/integrations.md#import-and-keep-in-sync)
- **Evidence capture.** For a service that can POST text or JSON, a team admin can create a named source under **Connections → Developer → Ingest webhooks**, choose its visibility and proposal setting, and give the sender its one-time URL or bearer token. Send a synthetic event and look for the named source on the timeline. This path needs no provider code. For a native evidence source such as monday.com, connect the account, share the desired resources, and activate capture instead. [Webhook setup](setup/ingest-webhooks.md) · [Native source setup](setup/integrations.md#native-integration-ui-model)

For an agent that needs to look something up on demand, configure a custom MCP server. For an external client that needs access to Timeline, use Timeline’s hosted MCP server. [Custom MCP servers](setup/custom-mcp.md) · [Hosted Timeline MCP](setup/timeline-mcp.md)

## Add a new integration

### Capture a new source as evidence

Start with the named webhook when the sender can use its authentication and delivery format. For example, a CRM can post a deal-stage notification that the team wants to search later. Replay the same sample that day and verify that the timeline contains one event. Check visibility from a second member’s account if the source is private. [Ingest webhook contract](setup/ingest-webhooks.md)

Build a native capture adapter when the source needs OAuth, selectable resources, signed provider callbacks, or a historical backfill. The adapter translates the provider payload into an integration event with a durable identity, source time, visibility and signal class. The shared writer preserves the evidence and routes downstream processing. Follow the template for registration, cursor handling, quota limits, recovery, tests and operator setup. [Native provider template](native-provider-template.md) · [Event writer](../packages/shared/src/integrations/event-writer.ts)

### Give a native source a board workflow

1. Define the smallest useful mapping. For a CRM, identify the provider account, pipeline, company ID, deal ID, company association and stage ID. Decide which Timeline field the rule can change. Keep stage labels for display and provider IDs for matching. [HubSpot adapter](../packages/shared/src/integrations/providers/hubspot.ts)
2. Translate eligible native events into import records. Identify relationships from provider data. GitHub, for example, can link a fixing PR to an issue through its closing references. Leave unrelated events available as evidence. [Record translation](../packages/shared/src/integrations/import-records.ts)
3. Extend the supported source kinds in the rule service, the provider constraint in the database, and the import controls in Connections. Add a migration for a new provider allowed to own a field. [Rule and identity schema](../packages/db/src/schema/board-imports.ts) · [Connections entry point](../apps/web/src/app/app/connections/provider-details-panel.tsx)
4. Extend the shared preview for the new source. Use the same matching logic for the preview, confirmation and subsequent deliveries. Remember confirmed identities across renames. Show ambiguous matches to the admin and keep the controlled field and unlink action visible on the card. [Board import service](../packages/shared/src/integrations/board-imports.ts) · [Import form](../apps/web/src/app/app/connections/import/import-form.tsx) · [Field authority](relational-memory.md#one-way-board-imports)
5. Exercise the whole workflow with synthetic records. Cover matching an existing object, a missing or ambiguous match, duplicate and late events, a restricted source, and a local edit after unlinking. Verify that webhook delivery and catch-up produce the same final board. [Import regression tests](../packages/shared/src/integrations/event-writer.test.ts) · [Browser acceptance tests](../e2e/integrations.spec.ts)

### Add a chat surface

Use Telegram or Slack as the working example. Verify the provider’s incoming request and resolve the conversation’s team, sender and visibility. Route questions to the shared conversation runtime and intentional captures to the evidence path. Implement the provider’s acknowledgements and replies through the conversation delivery adapter. Keep the provider event and message IDs so a retried delivery can resume the same turn. [Telegram ingress](../apps/web/src/app/api/telegram/webhook/route.ts) · [Slack ingress](../apps/web/src/app/api/slack/events/route.ts) · [Shared conversation contracts](../packages/shared/src/conversation-surfaces/types.ts) · [Turn handling](../packages/shared/src/conversation-surfaces/runtime.ts)

Verify a linked DM, an unlinked sender, a bound group or channel, an explicit capture and a repeated delivery. Check which workspace history the answer can use and where the reply is delivered. [Conversation diagnostics](conversation-diagnostics.md)

## Make the integration discoverable

Link the operator guide from the setup index. For a native source, register its capabilities in the in-app catalog. For a chat surface, expose the bot installation and identity-linking steps in Connections. Use the same capability labels on the public directory and connector page. [Setup index](setup/integrations.md) · [Native catalog](../packages/shared/src/integrations/registry.ts) · [Public-site registry](public-site-registry.md)
