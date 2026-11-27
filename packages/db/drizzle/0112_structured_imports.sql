ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'hubspot';
--> statement-breakpoint
CREATE TABLE board_import_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  authorized_by uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github','hubspot')),
  external_account_id text NOT NULL,
  resource_id text NOT NULL,
  board_id uuid NOT NULL,
  project_id uuid,
  import_issues boolean NOT NULL DEFAULT false,
  merged_prs boolean NOT NULL DEFAULT false,
  merges_since timestamptz NOT NULL DEFAULT now(),
  stage_lanes jsonb NOT NULL DEFAULT '{}',
  UNIQUE(team_id,provider,external_account_id,resource_id),
  UNIQUE(team_id,id),
  FOREIGN KEY(team_id,board_id) REFERENCES boards(team_id,id) ON DELETE CASCADE,
  FOREIGN KEY(team_id,project_id) REFERENCES entities(team_id,id)
);
--> statement-breakpoint
CREATE TABLE board_import_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  record_key text NOT NULL,
  entity_id uuid NOT NULL,
  item_id uuid,
  field text NOT NULL CHECK(field IN ('status','lane','reference')),
  state text NOT NULL CHECK(state IN ('active','paused','unlinked')),
  source_event_id uuid NOT NULL,
  FOREIGN KEY(team_id,source_event_id) REFERENCES raw_events(team_id,id) ON DELETE CASCADE,
  source_at timestamptz NOT NULL,
  source_url text,
  UNIQUE(rule_id,record_key),
  FOREIGN KEY(team_id,rule_id) REFERENCES board_import_rules(team_id,id) ON DELETE CASCADE,
  FOREIGN KEY(team_id,entity_id) REFERENCES entities(team_id,id) ON DELETE CASCADE,
  FOREIGN KEY(team_id,item_id) REFERENCES board_items(team_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX board_import_status_owner ON board_import_links(team_id,entity_id) WHERE field='status' AND state='active';
--> statement-breakpoint
CREATE UNIQUE INDEX board_import_lane_owner ON board_import_links(team_id,item_id) WHERE field='lane' AND state='active';
--> statement-breakpoint
CREATE TABLE board_import_effects (
  team_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  record_key text NOT NULL,
  source_event_id uuid NOT NULL,
  entity_id uuid,
  waiting_on text[] NOT NULL DEFAULT '{}',
  state text NOT NULL CHECK(state IN ('waiting','applied','skipped')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(team_id,rule_id) REFERENCES board_import_rules(team_id,id) ON DELETE CASCADE,
  FOREIGN KEY(team_id,source_event_id) REFERENCES raw_events(team_id,id) ON DELETE CASCADE,
  FOREIGN KEY(team_id,entity_id) REFERENCES entities(team_id,id) ON DELETE CASCADE,
  PRIMARY KEY(rule_id,record_key,source_event_id)
);
--> statement-breakpoint
CREATE INDEX board_import_effect_event_idx ON board_import_effects(team_id,source_event_id);
--> statement-breakpoint
CREATE INDEX board_import_waiting_idx ON board_import_effects USING gin(waiting_on) WHERE state='waiting';
--> statement-breakpoint
CREATE FUNCTION enforce_imported_field() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid;
BEGIN
  IF TG_TABLE_NAME='entities' THEN
    SELECT id INTO owner_id FROM board_import_links WHERE team_id=NEW.team_id AND entity_id=NEW.id AND field='status' AND state='active';
  ELSE
    SELECT id INTO owner_id FROM board_import_links WHERE team_id=NEW.team_id AND item_id=NEW.id AND field='lane' AND state='active';
  END IF;
  IF owner_id IS NOT NULL AND owner_id::text IS DISTINCT FROM current_setting('timeline.import_link',true) THEN
    RAISE EXCEPTION 'Stop syncing this field before editing it' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER check_imported_task_status BEFORE UPDATE OF status ON entities FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION enforce_imported_field();
--> statement-breakpoint
CREATE TRIGGER check_imported_board_lane BEFORE UPDATE OF lane_id ON board_items FOR EACH ROW WHEN(OLD.lane_id IS DISTINCT FROM NEW.lane_id) EXECUTE FUNCTION enforce_imported_field();
