ALTER TYPE message_intent ADD VALUE IF NOT EXISTS 'team_deletion';
--> statement-breakpoint
ALTER TABLE teams ADD COLUMN disabled_periods jsonb NOT NULL DEFAULT '[]';
ALTER TABLE teams ADD COLUMN disabled_at timestamptz;
ALTER TABLE teams ADD COLUMN disabled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE teams ADD COLUMN disabled_reason text;
ALTER TABLE teams ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE teams ADD COLUMN deletion_requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE teams ADD COLUMN deletion_started_at timestamptz;
ALTER TABLE teams ADD COLUMN deleted_at timestamptz;
ALTER TABLE teams ADD COLUMN lifecycle_work jsonb NOT NULL DEFAULT '{}';
UPDATE teams t SET disabled_at = a.created_at, disabled_by_user_id = a.actor_user_id,
  disabled_reason = a.reason
FROM (SELECT DISTINCT ON (team_id) team_id, created_at, actor_user_id, reason, action
      FROM platform_admin_audit WHERE action IN ('team.suspend', 'team.restore') ORDER BY team_id, created_at DESC) a
JOIN team_billing_accounts b ON b.team_id = a.team_id
WHERE t.id = a.team_id AND a.action = 'team.suspend' AND b.security_state = 'suspended';
-- Preserve an unknown original disable date while enforcing legacy suspensions independently of billing.
-- Waive unrecorded daily usage throughout unknown history rather than inventing active days.
UPDATE teams t SET disabled_at = COALESCE(t.disabled_at, now()),
  lifecycle_work = jsonb_build_object('billingPending', true, 'disabledDateUnknown', t.disabled_at IS NULL),
  disabled_periods = jsonb_build_array(jsonb_build_object('start', COALESCE(t.disabled_at, t.created_at)))
FROM team_billing_accounts b WHERE b.team_id = t.id AND b.security_state IN ('suspended', 'terminated');
CREATE INDEX teams_lifecycle_work_idx ON teams (id)
WHERE lifecycle_work <> '{}'::jsonb;

-- Block late producers at the persistence boundary, even if admitted before disabling.
CREATE FUNCTION reject_inactive_team_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('timeline.lifecycle_cleanup', true) = 'on' THEN RETURN NEW; END IF;
  PERFORM 1 FROM teams WHERE id = NEW.team_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM teams WHERE id = NEW.team_id AND
    (disabled_at IS NOT NULL OR deletion_started_at IS NOT NULL OR deleted_at IS NOT NULL)) THEN
    -- Verified account-level chat switching may deactivate old routing and
    -- cancel/archive its own session. Never permit identity/content changes,
    -- new rows, reactivation, or answer delivery through this exception.
    IF TG_OP = 'UPDATE' THEN
      IF TG_TABLE_NAME IN ('telegram_user_teams', 'slack_user_teams')
         AND to_jsonb(NEW)->>'is_active' = 'false'
         AND (to_jsonb(NEW) - ARRAY['is_active','updated_at']) =
             (to_jsonb(OLD) - ARRAY['is_active','updated_at']) THEN
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME = 'chat_surface_turns'
         AND to_jsonb(NEW)->>'status' = 'cancelled'
         AND to_jsonb(NEW)->>'error_code' IN ('team_changed', 'session_reset')
         AND (to_jsonb(NEW) - ARRAY['status','error_code','updated_at']) =
             (to_jsonb(OLD) - ARRAY['status','error_code','updated_at']) THEN
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME = 'chat_sessions'
         AND to_jsonb(NEW)->>'archived_at' IS NOT NULL
         AND (to_jsonb(NEW) - ARRAY['archived_at','updated_at']) =
             (to_jsonb(OLD) - ARRAY['archived_at','updated_at']) THEN
        RETURN NEW;
      END IF;
    END IF;
    RAISE EXCEPTION 'Workspace is disabled' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_suggestion_evidence_active_team BEFORE INSERT OR UPDATE ON agent_suggestion_evidence FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER agent_suggestion_items_active_team BEFORE INSERT OR UPDATE ON agent_suggestion_items FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER agent_suggestions_active_team BEFORE INSERT OR UPDATE ON agent_suggestions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER artifact_cluster_anchors_active_team BEFORE INSERT OR UPDATE ON artifact_cluster_anchors FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER artifact_cluster_members_active_team BEFORE INSERT OR UPDATE ON artifact_cluster_members FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER artifact_clusters_active_team BEFORE INSERT OR UPDATE ON artifact_clusters FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER artifact_evidence_associations_active_team BEFORE INSERT OR UPDATE ON artifact_evidence_associations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER audit_log_active_team BEFORE INSERT OR UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER board_item_changes_active_team BEFORE INSERT OR UPDATE ON board_item_changes FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER board_items_active_team BEFORE INSERT OR UPDATE ON board_items FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER board_lanes_active_team BEFORE INSERT OR UPDATE ON board_lanes FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER board_pins_active_team BEFORE INSERT OR UPDATE ON board_pins FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER boards_active_team BEFORE INSERT OR UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER calendar_event_entities_active_team BEFORE INSERT OR UPDATE ON calendar_event_entities FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER calendar_events_active_team BEFORE INSERT OR UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER chat_messages_active_team BEFORE INSERT OR UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER chat_sessions_active_team BEFORE INSERT OR UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER chat_surface_session_links_active_team BEFORE INSERT OR UPDATE ON chat_surface_session_links FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER chat_surface_turns_active_team BEFORE INSERT OR UPDATE ON chat_surface_turns FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER connection_attention_active_team BEFORE INSERT OR UPDATE ON connection_attention FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER conversation_reviews_active_team BEFORE INSERT OR UPDATE ON conversation_reviews FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER daily_digests_active_team BEFORE INSERT OR UPDATE ON daily_digests FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER document_chunks_active_team BEFORE INSERT OR UPDATE ON document_chunks FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER document_versions_active_team BEFORE INSERT OR UPDATE ON document_versions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER documents_active_team BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER entities_active_team BEFORE INSERT OR UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER entity_relationships_active_team BEFORE INSERT OR UPDATE ON entity_relationships FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER facts_active_team BEFORE INSERT OR UPDATE ON facts FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER folders_active_team BEFORE INSERT OR UPDATE ON folders FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER google_drive_file_snapshots_active_team BEFORE INSERT OR UPDATE ON google_drive_file_snapshots FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER ingest_webhook_credentials_active_team BEFORE INSERT OR UPDATE ON ingest_webhook_credentials FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER ingest_webhooks_active_team BEFORE INSERT OR UPDATE ON ingest_webhooks FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER integration_audit_log_active_team BEFORE INSERT OR UPDATE ON integration_audit_log FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER integration_webhook_delivery_targets_active_team BEFORE INSERT OR UPDATE ON integration_webhook_delivery_targets FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER integrations_active_team BEFORE INSERT OR UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER job_recovery_dismissals_active_team BEFORE INSERT OR UPDATE ON job_recovery_dismissals FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER mcp_oauth_tokens_active_team BEFORE INSERT OR UPDATE ON mcp_oauth_tokens FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER mcp_outbound_keys_active_team BEFORE INSERT OR UPDATE ON mcp_outbound_keys FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER mcp_outbound_oauth_grants_active_team BEFORE INSERT OR UPDATE ON mcp_outbound_oauth_grants FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER mcp_servers_active_team BEFORE INSERT OR UPDATE ON mcp_servers FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER meeting_capture_confirmations_active_team BEFORE INSERT OR UPDATE ON meeting_capture_confirmations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER meeting_transcript_chunks_active_team BEFORE INSERT OR UPDATE ON meeting_transcript_chunks FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER meeting_usage_active_team BEFORE INSERT OR UPDATE ON meeting_usage FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER meetings_active_team BEFORE INSERT OR UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER message_preferences_active_team BEFORE INSERT OR UPDATE ON message_preferences FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER monday_conversation_tombstone_invalidations_active_team BEFORE INSERT OR UPDATE ON monday_conversation_tombstone_invalidations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER monday_conversation_tombstones_active_team BEFORE INSERT OR UPDATE ON monday_conversation_tombstones FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER notifications_active_team BEFORE INSERT OR UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_changes_active_team BEFORE INSERT OR UPDATE ON object_changes FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_identity_facets_active_team BEFORE INSERT OR UPDATE ON object_identity_facets FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_note_mentions_active_team BEFORE INSERT OR UPDATE ON object_note_mentions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_notes_active_team BEFORE INSERT OR UPDATE ON object_notes FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_pins_active_team BEFORE INSERT OR UPDATE ON object_pins FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_summaries_active_team BEFORE INSERT OR UPDATE ON object_summaries FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_summary_runs_active_team BEFORE INSERT OR UPDATE ON object_summary_runs FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER object_views_active_team BEFORE INSERT OR UPDATE ON object_views FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER raw_events_active_team BEFORE INSERT OR UPDATE ON raw_events FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER reconciliation_evidence_active_team BEFORE INSERT OR UPDATE ON reconciliation_evidence FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER reconciliation_evidence_anchors_active_team BEFORE INSERT OR UPDATE ON reconciliation_evidence_anchors FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER reconciliation_outputs_active_team BEFORE INSERT OR UPDATE ON reconciliation_outputs FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER reconciliation_projection_outbox_active_team BEFORE INSERT OR UPDATE ON reconciliation_projection_outbox FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER reconciliation_runs_active_team BEFORE INSERT OR UPDATE ON reconciliation_runs FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER saved_meeting_aliases_active_team BEFORE INSERT OR UPDATE ON saved_meeting_aliases FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER saved_meetings_active_team BEFORE INSERT OR UPDATE ON saved_meetings FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER slack_conversation_bindings_active_team BEFORE INSERT OR UPDATE ON slack_conversation_bindings FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER slack_user_teams_active_team BEFORE INSERT OR UPDATE ON slack_user_teams FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER slack_workspace_teams_active_team BEFORE INSERT OR UPDATE ON slack_workspace_teams FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER task_category_assignments_active_team BEFORE INSERT OR UPDATE ON task_category_assignments FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER task_category_filter_versions_active_team BEFORE INSERT OR UPDATE ON task_category_filter_versions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER task_category_project_invalidations_active_team BEFORE INSERT OR UPDATE ON task_category_project_invalidations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER task_project_source_locks_active_team BEFORE INSERT OR UPDATE ON task_project_source_locks FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_calendar_settings_active_team BEFORE INSERT OR UPDATE ON team_calendar_settings FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_calendar_subscriptions_active_team BEFORE INSERT OR UPDATE ON team_calendar_subscriptions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_digest_destinations_active_team BEFORE INSERT OR UPDATE ON team_digest_destinations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_exports_active_team BEFORE INSERT OR UPDATE ON team_exports FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_first_run_active_team BEFORE INSERT OR UPDATE ON team_first_run FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_invites_active_team BEFORE INSERT OR UPDATE ON team_invites FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_meeting_settings_active_team BEFORE INSERT OR UPDATE ON team_meeting_settings FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_members_active_team BEFORE INSERT OR UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_onboarding_completions_active_team BEFORE INSERT OR UPDATE ON team_onboarding_completions FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_provider_resource_shares_active_team BEFORE INSERT OR UPDATE ON team_provider_resource_shares FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER team_visibility_defaults_active_team BEFORE INSERT OR UPDATE ON team_visibility_defaults FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER telegram_chat_bindings_active_team BEFORE INSERT OR UPDATE ON telegram_chat_bindings FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER telegram_link_tokens_active_team BEFORE INSERT OR UPDATE ON telegram_link_tokens FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER telegram_user_teams_active_team BEFORE INSERT OR UPDATE ON telegram_user_teams FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER timeline_moment_presentations_active_team BEFORE INSERT OR UPDATE ON timeline_moment_presentations FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER user_onboarding_dismissals_active_team BEFORE INSERT OR UPDATE ON user_onboarding_dismissals FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER user_pins_active_team BEFORE INSERT OR UPDATE ON user_pins FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER websites_active_team BEFORE INSERT OR UPDATE ON websites FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER website_runs_active_team BEFORE INSERT OR UPDATE ON website_runs FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER website_pages_active_team BEFORE INSERT OR UPDATE ON website_pages FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER website_notifications_active_team BEFORE INSERT OR UPDATE ON website_notifications FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();
CREATE TRIGGER website_sources_active_team BEFORE INSERT OR UPDATE ON website_sources FOR EACH ROW EXECUTE FUNCTION reject_inactive_team_write();

--> statement-breakpoint
-- Workspace audit content is erased only by an authorized permanent-cleanup operation.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('timeline.lifecycle_cleanup', true) = 'on'
     AND EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id AND deletion_started_at IS NOT NULL) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
-- Read-only support inspection may append its existing minimized product audit records.
DROP TRIGGER audit_log_active_team ON audit_log;
CREATE TABLE retired_team_routes (route_hash text PRIMARY KEY);
CREATE FUNCTION reserve_retired_team_routes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM retired_team_routes WHERE route_hash IN
      (encode(sha256(convert_to(lower(NEW.slug), 'UTF8')), 'hex'),
       encode(sha256(convert_to(lower(NEW.inbound_email), 'UTF8')), 'hex'))) THEN
      RAISE EXCEPTION 'Team address has been retired';
    END IF;
  ELSIF OLD.deletion_started_at IS NULL AND NEW.deletion_started_at IS NOT NULL THEN
    INSERT INTO retired_team_routes VALUES (encode(sha256(convert_to(lower(OLD.slug), 'UTF8')), 'hex')) ON CONFLICT DO NOTHING;
    IF OLD.inbound_email IS NOT NULL THEN
      INSERT INTO retired_team_routes VALUES (encode(sha256(convert_to(lower(OLD.inbound_email), 'UTF8')), 'hex')) ON CONFLICT DO NOTHING;
    END IF;
  ELSIF OLD.deletion_started_at IS NOT NULL AND NEW.deletion_started_at IS NULL THEN
    RAISE EXCEPTION 'Permanent deletion cannot be reversed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teams_retired_routes BEFORE INSERT OR UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION reserve_retired_team_routes();
