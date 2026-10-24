# @timeline/shared

Cross-package code: the `withTeam` team workspace port, the single `llm`
inference layer, Qdrant + S3 wrappers, Telegram dispatch, shared messaging and
email templates, the provider-neutral direct-conversation runtime and
surface-aware agent presentation policy, BullMQ queue names, the shared
embedding source planner, the
integrations module (Drive/Linear/GitHub/Monday.com/Slack/Sentry providers,
person-owned provider connections, team resource shares, active source paths, connection attention),
the policy-bound evidence-pack builder used by generic-webhook proposal
citations and Agent Ask,
the objects module, the reversible task-category classifier and state machine,
the documents module (Phase 9 —
folders/documents/versions/chunks scope + RustFS object-key builder + text
chunker), the meeting-bots module (Phase 10 — Recall.ai provider + Svix webhook
verifier) and meetings scope (meeting/chunk/usage helpers), and shared env
parsing.

## Why it exists

Two hard rules in this repo route through this package:

1. **Team isolation.** Every Postgres read goes through `withTeam(db, teamId, userId)` so row-level filtering can't be forgotten in a route or worker. Callers use named modules on the returned scope (`timeline`, `documents`, `meetings`, `objects`, `calendar`, `integrations`, `mcp`, `conversations`) instead of passing `db` and team identifiers around.
2. **One inference layer.** App and worker code call `llm.chatStructured()`, `llm.streamChat()`, `llm.embed()`, `llm.embedMany()`, `llm.transcribeAudio()`, and `llm.extractTextFromMedia()` — never the OpenAI or OpenRouter SDK directly. Exact pins and their `zdr_required` or `retained_no_training_exception` class live together in `src/llm/models.ts`. Recall meeting transcription remains a separate provider pipeline.

Putting both behind a single package keeps the rules enforceable.

Agent presentation is also centralized here. Literal web delivery keeps rich,
inspectable citations and the model's normal output budget. Every external chat
surface defaults to concise plain text and deterministic removal of internal
Timeline references before persistence and delivery. Its 900-token ceiling is
isolated to a no-tool final-answer pass, so retrieval and mutation arguments
retain the normal agent budget. If that presentation pass fails, returns empty,
or contains only removable internal material, the completed grounded draft and
its model attribution are retained; the draft still goes through deterministic
external formatting before delivery.

Outbound MCP agent calls use a separate compact profile that preserves inline
citations and returns parsed artifact references. Agent-enabled MCP keys and
unlinked trusted Telegram/Slack group actors use proposal-only authority:
team-visible reads, team-shared MCP tools, and new approval proposals without
proposal revision, personal pins, or canonical mutations. Successful
team-server MCP results become immutable team-visible evidence; personal-server
results stay private to their owner. Proposal-only authority constrains Timeline
state; enabled third-party MCP tools may still have their own external side
effects.

## How to use

```ts
import { withTeam, llm } from "@timeline/shared";
import { z } from "zod";

const scoped = withTeam(db, teamId, userId);
const events = await scoped.timeline.listEvents({ limit: 20 });
const impact = await scoped.timeline.listImpactItems(events.map((event) => event.id));
const docs = await scoped.documents.searchDocumentChunks({ query: "pricing" });
const tasks = await scoped.objects.listObjects({ type: "task", archived: false });

const { object } = await llm.chatStructured({
  schema: z.object({ summary: z.string() }),
  prompt: "Summarize today's timeline.",
});
```

Workspace commands:

```bash
pnpm --filter @timeline/shared build
pnpm --filter @timeline/shared test
```

## Where it fits

- DB layer: [packages/db/README.md](../db/README.md).
- Operating memory engine: [docs/relational-memory.md](../../docs/relational-memory.md).
- Evidence-pack rollout gates:
  [docs/cross-source-evidence.md](../../docs/cross-source-evidence.md).
- Documents helpers: `@timeline/shared/documents` exports the document module
  surface, and `@timeline/shared/documents/presentation` exports display-title
  and generated-filename presentation helpers used by web and worker code.
- Provider strategy and pinning: [docs/setup/openrouter.html](../../docs/setup/openrouter.html).
- Native integration setup and provider connections:
  [docs/setup/integrations.html](../../docs/setup/integrations.html).
- Telegram dispatch, `/` command-menu registration, and Postmark-backed messaging: [docs/setup/telegram.html](../../docs/setup/telegram.html), [docs/setup/postmark.html](../../docs/setup/postmark.html).
- Meeting bots (Phase 10): [docs/setup/meeting-bots.html](../../docs/setup/meeting-bots.html).
