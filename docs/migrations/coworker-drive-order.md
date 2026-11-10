# Drive and coworker migration ordering

This runbook applies to databases that received the November 2026 Drive/coworker branches. It is a lineage constraint, not a statement of the currently deployed branch.

Drive migrations `0097_google_drive_v1` through `0100_google_drive_snapshot_ancestry` retain their original journal `when` values. Coworker SQL tags and contents remain `0097_auth_continuations`, `0098_agent_provisioning`, and `0099_agent_reporting`, journaled after Drive at indices 104–106 with later timestamps.

- Fresh databases apply Drive, then coworker migrations.
- Drive-applied databases skip the existing Drive high-water mark and apply coworker next.
- Never change Drive journal timestamps to force a replay.
- A database that applied coworker at the original 0097–0099 timestamps has a different lineage. Inspect its migration ledger and rehearse a repair against a copy; do not blindly replay these SQL files.

The journal in `packages/db/drizzle/meta/_journal.json` is authoritative for migration order. Back up the database before intervention. Normal migration execution remains owned by `packages/db`.
