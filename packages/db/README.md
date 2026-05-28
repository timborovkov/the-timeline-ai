# @timeline/db

Drizzle ORM schema, migrations, and the `migrate` script for the Timeline Postgres database.

## Why it exists

One canonical schema definition shared by `apps/web`, `apps/worker`, and any future workspace consumer. The migrate entry point runs as a pre-deploy command on Railway and from the web start wrapper under an advisory lock, so schema changes land before traffic and freshly reset dev environments converge on boot.

## How to use

```ts
import { db, raw_events } from "@timeline/db";

const rows = await db.select().from(raw_events).limit(10);
```

All team-scoped reads must go through `withTeam(db, teamId, userId)` from `@timeline/shared` — never read `raw_events` directly without it.

Workspace commands:

```bash
pnpm db:generate   # drizzle-kit generate after schema change
pnpm db:migrate    # apply pending migrations
pnpm db:studio     # local schema browser
```

## Where it fits

- Deploy/startup migration wiring: [docs/railway.html](../../docs/railway.html).
- Team-scope contract: [packages/shared/README.md](../shared/README.md).
- Data model overview: [docs/product-brief.html](../../docs/product-brief.html).
