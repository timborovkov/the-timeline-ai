const INTEGRATION_AUDIT_SUMMARIES: Record<string, string> = {
  backfill_enqueue_failed: 'Unable to queue sync',
  backfill_requested: 'Sync requested',
  'backfill_skipped:provider_budget': 'Sync paused for provider quota',
  connect: 'Provider account connected',
  disconnect: 'Provider disconnected',
  disconnect_failed: 'Provider disconnect failed',
  drive_page_cap_hit: 'Google Drive sync reached its page limit',
  github_backfill_partial: 'GitHub historical sync completed with gaps',
  github_commit_cursor_target_missing: 'GitHub commit cursor was reset',
  github_commit_gap_checkpoint: 'GitHub commit sync checkpoint saved',
  github_commit_history_truncated: 'GitHub commit history was limited',
  github_incremental_partial: 'GitHub update sync completed with gaps',
  harvest_failed: 'File content could not be read',
  harvest_skipped: 'File content skipped',
  monday_board_synced: 'Monday board synced',
  targeted_item_board_mismatch: 'Selected item is on a different board',
  targeted_item_missing: 'Selected item was not found',
  webhook_provision_failed: 'Webhook setup failed',
  webhook_provision_skipped_missing_scopes: 'Webhook setup needs more permissions',
  webhooks_reconciled: 'Webhook subscriptions updated',
};

export function integrationAuditSummary(kind: string): string {
  return (
    INTEGRATION_AUDIT_SUMMARIES[kind] ??
    kind
      .replaceAll(/[_:.-]+/g, ' ')
      .trim()
      .replace(/^./, (first) => first.toUpperCase())
  );
}
