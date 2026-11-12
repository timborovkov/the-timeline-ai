ALTER TABLE boards ADD COLUMN qualification_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN qualification_instructions text NOT NULL DEFAULT '',
 ADD COLUMN qualification_revision integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE board_qualification_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 source_event_id uuid REFERENCES raw_events(id) ON DELETE CASCADE,
 platform_operator_session_id uuid,
 version integer NOT NULL DEFAULT 1, board_cursor uuid,
 requested_board_id uuid REFERENCES boards(id) ON DELETE CASCADE,
 requested_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, failure_code text,
 FOREIGN KEY (team_id, entity_id) REFERENCES entities(team_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX board_qualification_request_identity ON board_qualification_requests(team_id,user_id,entity_id);
CREATE INDEX board_qualification_request_due ON board_qualification_requests(available_at);
--> statement-breakpoint
CREATE TABLE board_qualification_evaluations (
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
 input_hash text NOT NULL, decision text NOT NULL, evaluated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (team_id, board_id) REFERENCES boards(team_id,id) ON DELETE CASCADE,
 FOREIGN KEY (team_id, entity_id) REFERENCES entities(team_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX board_qualification_evaluation_identity ON board_qualification_evaluations(team_id,board_id,entity_id);
