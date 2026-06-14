# @timeline/shared

Cross-package code: the `withTeam` team workspace port, the single `llm`
inference layer, Qdrant + S3 wrappers, Telegram dispatch, shared messaging and
email templates, BullMQ queue names, the shared embedding source planner, the
integrations module (Drive/Linear/GitHub providers, person-owned provider
connections, team resource shares, active source paths, connection attention),
the objects module, the documents module (Phase 9 —
folders/documents/versions/chunks scope + RustFS object-key builder + text
chunker), the meeting-bots module (Phase 10 — Recall.ai provider + Svix webhook
verifier) and meetings scope (meeting/chunk/usage helpers), and shared env
parsing.

## Why it exists

Two hard rules in this repo route through this package:

1. **Team isolation.** Every Postgres read goes through `withTeam(db, teamId, userId)` so row-level filtering can't be forgotten in a route or worker. Callers use named modules on the returned scope (`timeline`, `documents`, `meetings`, `objects`, `calendar`, `integrations`, `mcp`) instead of passing `db` and team identifiers around.
2. **One inference layer.** App and worker code call `llm.chat()`, `llm.embed()`, `llm.transcribe()` — never the OpenAI or OpenRouter SDK directly. Swapping providers or pinning a model happens here, once.

Putting both behind a single package keeps the rules enforceable.

## How to use

```ts
import { withTeam, llm } from "@timeline/shared";

const scoped = withTeam(db, teamId, userId);
const events = await scoped.timeline.listEvents({ limit: 20 });
const impact = await scoped.timeline.listImpactItems(events.map((event) => event.id));
const docs = await scoped.documents.searchDocumentChunks({ query: "pricing" });
const tasks = await scoped.objects.listObjects({ type: "task", archived: false });

const { text } = await llm.chat({ messages, model: "qwen/qwen3.7-max" });
```

Workspace commands:

```bash
pnpm --filter @timeline/shared build
pnpm --filter @timeline/shared test
```

## Where it fits

- DB layer: [packages/db/README.md](../db/README.md).
- Provider strategy and pinning: [docs/setup/openrouter.html](../../docs/setup/openrouter.html).
- Native integration setup and provider connections:
  [docs/setup/integrations.html](../../docs/setup/integrations.html).
- Telegram dispatch and Postmark-backed messaging: [docs/setup/telegram.html](../../docs/setup/telegram.html), [docs/setup/postmark.html](../../docs/setup/postmark.html).
- Meeting bots (Phase 10): [docs/setup/meeting-bots.html](../../docs/setup/meeting-bots.html).
