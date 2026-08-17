# Acme Labs demo corpus

Deterministic fictional workspace for local demos and recorded walkthroughs. Nothing
here is real customer data. Seed it, wipe it, and seed it again.

## Commands

Export the root `.env` first (`set -a; . ./.env; set +a`). Then:

```bash
pnpm db:migrate
pnpm demo:seed
```

`demo:seed` runs `dev:seed`, indexes every fixture-version raw event, fact, document
chunk, and meeting chunk through the production embed worker, then runs `demo:verify`.

```bash
pnpm demo:verify   # re-check a previously seeded workspace
pnpm demo:reset    # wipe local Postgres/Qdrant/S3/Redis, migrate, and seed again
```

`demo:reset` is `pnpm dev:wipe && pnpm demo:seed`. Wipe requires
`NODE_ENV=development` or `test`. On Railway it also needs
`ALLOW_DESTRUCTIVE_DEV_WIPE=wipe-dev`. Seed refuses production, unapproved
remote databases/Qdrant, and non-local S3 unless `ALLOW_DEV_SEED` /
`ALLOW_DEV_SEED_STORAGE` carry the documented acknowledgements.

`pnpm dev:seed:heavy` is optional extra Acme Labs volume for infinite-scroll and
virtualization tests. It runs after the verified corpus and is not part of
`demo:seed`.

A development `OPENROUTER_API_KEY` is required so search vectors are real. Documents
are marked `embedded` only after Qdrant confirms the points. Verification checks every
seeded login password, downloads document bytes and hashes them (same-size tampering
fails), confirms Northstar search hits, and confirms every expanded-corpus document
version is `embedded` with a Qdrant point for each corpus chunk id.

## Logins

Password for every seeded member: `timeline-dev`

| Email | Role | Title |
| --- | --- | --- |
| `owner@timeline.dev` | owner | CEO (Avery Timeline) |
| `member@timeline.dev` | member | Head of Product (Mika Product) |
| `jordan@timeline.dev` | admin | Head of Engineering (Jordan Hale) |
| `sam@timeline.dev` | member | Design lead (Sam Rivera) |
| `riley@timeline.dev` | member | Marketing lead (Riley Cho) |
| `casey@timeline.dev` | member | Account executive (Casey Novak) |
| `quinn@timeline.dev` | member | People operations (Quinn Okonkwo) |
| `harper@timeline.dev` | member | Finance lead (Harper Singh) |

Start demos as Avery (`owner@timeline.dev`). Mika is the product counterpart on the
Northstar pilot. The other six people exist so boards, hiring, GTM, and Ask history
look like a month of active use.

## Story

Acme Labs is an eight-person startup building **Atlas**, an evidence-backed working
history product. They have been using Timeline itself for about a month (mid-July
through 14 August 2026).

The through-line:

1. **Northstar Works** is the design partner. Elena Park committed to a sample export,
   Avery handed validation to Mika, the team accepted a CSV fallback, and Linear
   `NORTH-42` is still blocked on field-mapping. Elena later delayed confirmation to
   19 August.
2. **Importer reliability** shipped as `atlas-0.8.0` after Sentry `ATLAS-218` (CSV
   preview 500s). Decision: replay previews from stored bytes, never the live vendor
   endpoint.
3. **Series A** is in diligence with **Northwind Capital** (Priya Shah) as lead.
   Linden Ventures will follow. Harbor Peak is only a catch-up. The data room opened
   13 August.
4. **Dealflow** is live: Helio Retail, Brightline Health, Moss & Co, Orchard Finance,
   and a lost Kite Logistics on-prem request. Polar Studio is inbound and waiting on
   an add-to-board approval, not a live dealflow card.
5. **GTM** is heading to an Atlas beta webinar on 20 August. Brand voice is quiet and
   citation-first.
6. **Hiring**: product designer (Maya Chen, final round 15 August) and a reopened
   senior backend loop.

Ask “what did the team achieve last week?” as Avery to walk the cited recap.

## Seeded surfaces

| Surface | What you should see |
| --- | --- |
| Timeline | ~2,500 events across a month of use. Weekdays carry ~90–100 raw events that collapse into fewer moments (GitHub workflows/PRs, Slack threads in `#eng` `#product` `#gtm` `#hiring`, Linear/Monday/Sentry/Drive, email threads, Telegram bursts, notes, documents, and the Ledger webhook). Weekends stay lighter. |
| Objects | Tasks, deals, companies, people, decisions, incidents, hiring loops, follow-ups, projects |
| Boards | Atlas Launch (tasks plus launch work), Customer dealflow, Series A funding |
| Documents | Code of conduct, office rules, DPA excerpt, MSA excerpt, contractor excerpt, strategy memo, one-pager, pitch narrative, onboarding, brand voice, security FAQ, plus the Northstar handoff brief |
| Meetings | Weekly standups from 14 July through 11 August, importer incident review, Northwind partner meeting, Brightline scoping, Maya Chen interview; saved weekly standup with auto-join and a scheduled 18 August occurrence |
| Ask | Eight historic sessions, including last-week recap, Northstar status, dealflow, hiring, webinar blockers, and the code of conduct |
| Approvals | Fourteen pending proposals plus one already-accepted CSV-replay decision |
| Digests | Twenty weekdays of Avery’s daily digest history. Live digest send stays off so the worker can run without Postmark, Slack, or Telegram delivery. Team settings still show the default email destination plus disabled Slack `#product` and Telegram “Acme leadership” destinations. |
| Setup | Team checklist completed and dismissed for Avery |
| Capture | Slack `#product` `#gtm` `#eng` `#hiring`, Telegram “Acme leadership”, inbound email whitelist, Ledger webhook |

Native GitHub, Linear, Monday.com, Sentry, and Google Drive connections are fake,
encrypted, and **disabled for sync** so local workers do not call real providers.

## Fake credentials

These are not production secrets. They exist so settings screens look configured.

| Provider | Value |
| --- | --- |
| GitHub access | `gho_dev_seed_access_token_123` |
| GitHub refresh | `ghr_dev_seed_refresh_token_123` |
| Linear access | `lin_api_dev_seed_access_token_456` |
| Linear refresh | `lin_refresh_dev_seed_refresh_token_456` |
| Monday.com | `mon_dev_seed_access_token_789` |
| Sentry | `sntrys_dev_seed_access_token_012` |
| Google Drive | `ya29.dev_seed_drive_access_token` |
| Slack bot | `xoxb-demo-seed-acme-labs` |
| Ledger ingest webhook | `tli_demo_seed_ledger_billing_0001` |
| Outbound MCP reader | `tla_demo_seed_read_key_000000000000000000000000` |
| Ledger inbound MCP bearer | `mcp_demo_seed_ledger_bearer_0001` |

## Glossary

### People (workspace objects, not always logins)

- **Elena Park** — Northstar customer lead (`elena.park@northstar.example`)
- **Priya Shah** — Northwind Capital partner
- **Dana Cole** — Brightline Health buyer
- **Maya Chen** — designer candidate in final round
- **Nadia Holm** — Linden Ventures partner (pending person proposal)

### Companies and deals

- **Northstar Works** — design partner. The dealflow Active lane holds the Northstar Works company; invoice `inv_2041` paid
- **Helio Retail** — Qualified, technical validation 21 August
- **Brightline Health** — Proposal, CSV + evidence packs only. The company record is **Brightline Health account**.
- **Moss & Co** — Qualified, wants to keep Monday.com
- **Orchard Finance** — Scoping, 12-seat research workspace
- **Polar Studio** — inbound logo, founder demo 19 August, pending add-to-board proposal
- **Kite Logistics** — Lost (on-prem)
- **Northwind Capital lead** — Diligence
- **Linden Ventures follow** — Intro, same data room
- **Harbor Peak catch-up** — Intro, not a lead

### Product objects

- **Project Atlas** — customer timeline unification beta
- **Northstar pilot** — canonical cited evidence cluster
- **Validate Northstar pilot export** — blocked task (`NORTH-42`)
- **Use CSV fallback for Northstar pilot** — accepted decision
- **CSV preview 500s / ATLAS-218** — resolved incident
- **Replay CSV preview from stored bytes** — accepted decision
- **Series A process** — diligence
- **GTM launch system** — webinar + one-pager

### Documents

People & Ops: `Code of conduct.pdf`, `Helsinki office rules.pdf`, `Vendor DPA excerpt.pdf`, `Contractor agreement excerpt.pdf`, `New-hire onboarding.md`
Product: `Atlas strategy memo.md`, `Brand voice guide.md`, `Security FAQ.md`
Fundraising: `Series A investor one-pager.md`, `Northstar MSA excerpt.md`
GTM: `Pitch narrative.md`
Email attachment: `Northstar pilot handoff brief.txt` (canonical search fixture)

### Recurring demo questions

- “What did the team achieve last week?”
- “What is the current status of the Northstar pilot?”
- “Who owns Series A diligence?”
- “What is blocking the Atlas importer?”
- “Show the dealflow pipeline.”
- “What does the code of conduct say about private events?”
- “Where is Maya Chen in the designer loop?”
- “What is still blocking the Atlas beta webinar?”
