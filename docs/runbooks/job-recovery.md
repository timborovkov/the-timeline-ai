# Job reconciliation

## Scheduled reconciler

Set `CRON_SECRET` in shared variables to enable `POST /api/cron/reconcile`. The endpoint re-enqueues stuck transcribe / extract / embed jobs for raw events idle past 15 minutes, and is idempotent because workers are deterministic on `raw_events` and Qdrant point ids. Run it from Railway's scheduler (or any cron service) every few minutes:

    curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
      https://thetimeline.cc/api/cron/reconcile

Leave `CRON_SECRET` unset to disable the endpoint (returns 503). The handler also accepts `GET` for cron services that don't support POST bodies.

**Dead-letter behavior.** Each (row, stage) is re-enqueued at most 3 times. After that the reconciler stamps `source_metadata.reconcile_giveup_<stage>` with the giveup timestamp and skips the row on subsequent runs. The response payload includes a `deadLettered` count for dashboards. To retry a dead-lettered row manually, clear the giveup key from `source_metadata`:

    UPDATE raw_events
    SET source_metadata = source_metadata
      - 'reconcile_giveup_transcribe'
      - 'reconcile_attempts_transcribe'
    WHERE id = '<uuid>';

Use the application job-recovery surface for supported cases. SQL repair requires an identified record, reviewed scope and rollback plan; it is not routine troubleshooting.
