# @timeline/db

Drizzle ORM schema, migrations, and the `migrate` script for the Timeline Postgres database.

## Why it exists

One canonical schema definition shared by `apps/web`, `apps/worker`, and any future workspace consumer. The migrate entry point runs as a pre-deploy command on Railway and from web/worker startup under an advisory lock, so schema changes land before traffic and service-only redeploys converge before app code starts using the database.

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

## Connection guardrails

Runtime Postgres clients should come from `createPgClient()` or `getDb()`, not a
direct `postgres()` call. The shared builder applies:

- `application_name` labels for lock diagnosis (`timeline-web`,
  `timeline-worker`, `timeline-migrator`, `timeline-migration-waiter`,
  `timeline-reset`, or `timeline-script`).
- Pool lifecycle limits: 10 second connection timeout, 30 second idle timeout,
  and 30 minute max connection lifetime.
- Session fuses: 10 second `lock_timeout`, 120 second `statement_timeout`, and
  60 second `idle_in_transaction_session_timeout`.

The migrator uses one connection, a 10 second lock wait, and a 10 minute
statement budget so blocked deploys fail clearly while legitimate schema work
has room to finish.

## Where it fits

- Deploy/startup migration wiring: [docs/railway.html](../../docs/railway.html).
- Team-scope contract: [packages/shared/README.md](../shared/README.md).
- Data model overview: [docs/product-brief.html](../../docs/product-brief.html).
