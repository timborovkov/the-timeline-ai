# The Timeline — Product Brief

## What we're building

A multi-tenant team memory system that replaces the patchwork of CRMs, internal wikis, FAQs, and TODO lists. Team members capture work as it happens — voice notes after a call, a forwarded email, a quick text dump at end of day — and The Timeline agentically compiles it into a searchable, queryable history of who did what, talked to whom, and decided what.

The interaction model is voice-first and chat-first. People resist updating systems of record because the systems demand structure up front. The Timeline accepts unstructured capture and *derives* the structure, so the cost of contributing is near zero.

## Problem

Existing tools punish the act of recording. CRMs require you to know the contact, the deal stage, the next step before you can log anything. Wikis demand a page hierarchy. Ticket boards demand a project and status. The result: people don't update them, history is lost, and teammates ask each other "what happened with X" in Slack threads that themselves get lost.

The cost isn't just inconvenience — it's that *organizational memory leaks*. Conversations with clients, decisions made in meetings, the reasoning behind a choice three months ago — all of it lives in people's heads or scattered across tools.

## Solution

One ingest pipeline, many capture surfaces. Voice notes, written notes, forwarded emails, Telegram messages all flow into the same event stream. An LLM extracts entities (people, companies, projects), facts ("Tim discussed SaaS licensing with John Ternus at Apple"), and relationships. Everything is embedded and indexed. An agent answers questions over the timeline: *what did the team work on yesterday*, *what was discussed with Ternus last time*, *what's outstanding for the Acme account*.

The product is intentionally low-structure on input and high-structure on output.

## Target user

Small to mid-sized teams (5–50 people) doing knowledge work where context compounds: sales, consulting, product, founding teams. The kind of team where one person being out of the loop on a client conversation creates real friction.

## Core principles

**Capture must be frictionless.** If recording a thought takes more than five seconds of overhead, people won't do it. Voice memo via Telegram in three taps is the bar.

**Raw events are immutable.** Whatever was said or written goes in as-is and never changes. Derived facts can be re-extracted as models improve; the source of truth is the raw event.

**Privacy is per-event, not per-team.** A team member's end-of-day brain dump might include things they don't want broadcast verbatim. Visibility lives on the event.

**The agent's answers are auditable.** Every fact the agent surfaces links back to the raw event(s) it came from. No black-box summaries.

**Re-processability is non-negotiable.** Extraction prompts and models will improve. Replaying historical raw events through the new pipeline must be cheap and routine.

## Architecture overview

### Capture surfaces

- **Web/PWA**: typed notes, uploaded audio, drag-and-drop documents.
- **Telegram bot**: voice memos, text, forwarded messages. Personal DMs and team group chats both supported.
- **Email ingest**: forward, CC, or BCC to a per-team address. Postmark handles inbound parsing.

### Processing pipeline

1. **Raw event lands.** Immutable record: source, author, team, timestamp, content reference (text inline, audio in RustFS).
2. **Transcription** (if audio). OpenRouter `/audio/transcriptions` for short memos; direct provider fallback for long-form.
3. **Extraction.** LLM pulls entities, facts, and relationships from the transcribed/raw text. Output is structured JSON linked back to the raw event.
4. **Entity resolution.** New entities are matched against existing ones ("Apple" vs "Apple Inc" vs "AAPL") with LLM-assisted deduplication and human override.
5. **Embedding.** Raw text and extracted facts are embedded via OpenRouter (pinned to `text-embedding-3-small`, 1536 dims).
6. **Indexing.** Vectors land in Qdrant with team-scoped payload filters; structured facts land in Postgres.

### Query surfaces

- **Timeline view.** Reverse-chronological feed, filterable by entity, author, date, source.
- **Entity pages.** Auto-generated profile views: a client, a project, a person. Pulls every raw event and fact tagged to that entity.
- **Agent chat.** Natural-language queries over the timeline. Tool-use pattern: agent queries Qdrant for semantic context, queries Postgres for structured filters, synthesizes an answer with citations.

### Stack

| Layer | Choice |
|---|---|
| Repo | pnpm + Turborepo monorepo (`apps/web`, `apps/worker`, `packages/*`) |
| Frontend | Next.js (TypeScript), PWA, Auth.js |
| Backend | Next.js API routes / server actions, Node.js workers (BullMQ) |
| Database | Postgres (entities, events, metadata, team membership) |
| Vector store | Qdrant (shared collection with team-scoped filters) |
| Object storage | RustFS, S3-compatible, AWS SDK |
| Job queue | BullMQ on Redis |
| Inference | OpenRouter (chat, embeddings, transcription) via OpenAI SDK and Vercel AI SDK |
| Email ingest | Postmark inbound |
| Messaging | Telegram Bot API |
| Local dev | Docker Compose — full self-contained stack |
| Hosting | Railway (staging + production environments) |

### Multi-tenancy model

- `team_id` on every row, enforced at the query layer (not application logic).
- Qdrant: one collection with mandatory `team_id` payload filter on every query. Reviewed if cross-team query patterns prove rare and stronger isolation guarantees become necessary — at which point move to per-team collections.
- Row-level visibility on events (`private` / `team` / `specific_users`) layered on top of team isolation.

## Data model (high level)

**Three layers, deliberately separated:**

1. **Raw events** — append-only. Source, author, team, timestamp, content. Audio files in RustFS, text inline.
2. **Extracted facts** — LLM-derived, regenerable. Each fact links to the raw event(s) it came from and the entities it references.
3. **Entities** — Apple, John Ternus, "SaaS licensing deal Q2". Stable IDs, deduplication, human override.

A single raw event ("Met with John from Apple about licensing") produces multiple facts (Tim met John; topic was licensing; date was today) and references multiple entities (Tim, John Ternus, Apple, the licensing deal). All linked, all auditable.

## Telegram binding model

**Hybrid: groups bound, DMs have an active team pointer.**

- **Group chats** are permanently bound to one team via `/link <token>`. The team's group chat *is* that team's. Bot must have privacy mode disabled to read non-command messages.
- **DMs** have a per-user active-team pointer. Users link multiple teams and switch via `/team`. `/whereami` confirms current attribution before sending sensitive content.
- **Link tokens** are scoped (`personal` or `group`), 15-minute TTL, single-use. Group tokens require team-admin issuance.
- **Deep linking** via `t.me/YourBot?startgroup=TOKEN` makes "add bot to group + bind" a single action.

## AI provider strategy

Single inference layer through OpenRouter wherever possible:

- **Chat / summarization / extraction**: OpenRouter via Vercel AI SDK. Model flexibility, streaming UI, tool calls.
- **Embeddings**: OpenRouter via OpenAI SDK. **Pinned to one model.** Changing the embedding model invalidates the entire index — done only via documented re-embed procedure.
- **Transcription**: OpenRouter via OpenAI SDK. Per-request model choice fine; output is text, doesn't affect index integrity.
- **Fallback**: direct provider access only for limitations OpenRouter hasn't yet covered (e.g., URL-based audio input for long recordings, if still missing).

Internal abstraction: `llm.chat()`, `llm.embed()`, `llm.transcribe()` — keeps the rest of the codebase provider-agnostic and makes testing tractable.

## Infrastructure

### Local development

Docker Compose brings up the full stack: Postgres, Redis, Qdrant, RustFS (with auto bucket initialization). App and workers run on the host with hot reload via `pnpm dev`. A `--profile app` flag in compose runs everything containerized when prod parity matters.

### Production / staging on Railway

Two Railway environments per project. Each runs:

- **`web`** — Next.js app, public domain, Telegram + Postmark webhook receivers.
- **`worker-transcribe`**, **`worker-extract`**, **`worker-embed`** — separate Railway services, same Docker image, different start commands. Lets each scale independently and prevents one slow worker type from starving another.
- **Postgres** — Railway managed plugin.
- **Redis** — Railway managed plugin.
- **Qdrant** — custom service from `qdrant/qdrant` image, persistent volume.
- **RustFS** — custom service from `rustfs/rustfs` image, persistent volume.

Service-to-service references in Railway connect everything via private networking; no public endpoints for infra services.

## What's out of scope for v1

- **Knowledge base / Drive-like document storage.** Later, on RustFS.
- **System integrations** (HubSpot, Linear, Notion, Google Drive, Slack). Later.
- **Real-time collaboration** on entity pages. Later.
- **Mobile native apps.** PWA covers this for v1.
- **End-to-end encryption.** At-rest and in-transit encryption only; full E2EE conflicts with server-side LLM processing.

## Future roadmap

- **Knowledge base** on RustFS: contracts, static docs, version history. Drive-like UX.
- **System integrations**: pull events from HubSpot, Linear, Notion, Google Drive, Slack. Same pipeline, more sources.
- **Proactive agent**: agent notices a forgotten follow-up and surfaces it. "You said you'd send Ternus a deck by Friday."
- **Team digests**: auto-generated end-of-week summaries per team or per project.
- **Export and portability**: full team data export. Important for trust.

## Risks and unknowns

- **RustFS maturity.** Young storage layer holding customer voice memos and emails. Versioning enabled day one; nightly `rclone sync` to secondary store (Backblaze B2 or similar) from Railway cron; periodic restore drills.
- **Qdrant scaling.** Vectors live in RAM. Monitor RAM usage from day one; plan to shard or move to managed Qdrant Cloud past a certain team count.
- **Entity resolution quality.** "Apple" vs "Apple Inc" vs random Apple in a different context. Will require human-in-the-loop merge UI early.
- **LLM cost at scale.** Re-extraction on prompt improvements is expensive. Cap and batch; consider cheaper extraction models for routine re-runs.
- **Telegram privacy mode trade-off.** Disabling it means the bot sees every group message. Onboarding must be explicit about this — it's a feature for capture, but users need to know.
- **Vector index drift.** Embedding model upgrades over time. Documented re-embed procedure from v1; never silent migration.
- **Railway lock-in.** Build files (Dockerfiles, compose) are portable; Railway-specific config is in `railway.json` files and service env vars. Migration cost to bare cloud is moderate but not zero.

## Success criteria

- A team member can record a voice note and have it queryable via the agent within 60 seconds of pressing send.
- "What did we talk about with X last time" returns a correct, cited answer with >90% accuracy on populated teams.
- A new team member can be onboarded to a team's timeline and become productive (asking the agent useful questions) within their first day.
- Active teams contribute at least one event per active member per workday — capture friction is low enough that it becomes habitual.
