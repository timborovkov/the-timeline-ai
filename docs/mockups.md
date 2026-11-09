# Visual mockups (not product)

Clickable visual studies for three product ideas. They are **not** shipped
features. They do not use auth, the database, APIs, schema, or live product
routes, and they must not be merged as if they did.

Open locally at `/mockups` while `bun run --filter @timeline/web dev` is
running. Preview deployments of this branch can use the same paths. Search
engines are told not to index them (`noindex`, robots disallow, `X-Robots-Tag`).

All names, messages, and citations are hardcoded Acme Labs **example data** from
the [demo corpus](demo-corpus.md).

## Routes

| Path | Idea |
| --- | --- |
| `/mockups` | Index with a one-line description of each study |
| `/mockups/today` | Brief-first home (“Today”) |
| `/mockups/milestones` | Milestone history for Northstar Works |
| `/mockups/approve` | Approve & send inside Slack/Telegram and in-app Ask |

The real app navigation does not link here. Mockup chrome copies the Quiet
Archive shell so the studies read as future Timeline screens, including light
and dark.

## What these are not

- Not a replacement for Home, object detail, Ask, Slack, or Telegram
- Not wired to proposals, suggestions, or send paths
- Not a design-system change; [design.md](../design.md) remains the contract
  for the live product
