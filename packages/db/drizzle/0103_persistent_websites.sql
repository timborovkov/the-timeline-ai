CREATE TABLE websites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 url text NOT NULL, hostname text NOT NULL, subject text NOT NULL, created_by uuid NOT NULL, schedule_by uuid, schedule_principal jsonb,
 schedule jsonb NOT NULL DEFAULT '{"frequency":"manual","time":"09:00","weekday":1,"timezone":"UTC"}',
 paused boolean NOT NULL DEFAULT false, blocked_reason text, next_scan_at timestamptz, last_scan_at timestamptz,
 archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX websites_active_url ON websites(team_id,url) WHERE archived_at IS NULL;
CREATE INDEX websites_due ON websites(next_scan_at);
CREATE TABLE website_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 website_id uuid NOT NULL REFERENCES websites(id), requested_by uuid NOT NULL, principal jsonb, trigger text NOT NULL,
 idempotency_key text NOT NULL, status text NOT NULL DEFAULT 'queued', billing_policy text NOT NULL DEFAULT 'website-v1',
 units_per_page integer NOT NULL DEFAULT 20, page_count integer NOT NULL DEFAULT 0, changed_count integer NOT NULL DEFAULT 0,
 source_units integer NOT NULL DEFAULT 0, provider_credits integer, estimated_provider_cost_eur double precision, failure_reason text, provider_started_at timestamptz, provider_finished_at timestamptz,
 lease_until timestamptz, handoff_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX website_runs_idempotency ON website_runs(team_id,idempotency_key);
CREATE UNIQUE INDEX website_runs_one_active_team ON website_runs(team_id) WHERE status IN ('queued','crawling','processing');
CREATE INDEX website_runs_source ON website_runs(team_id,website_id,created_at);
CREATE TABLE website_pages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 website_id uuid NOT NULL REFERENCES websites(id), url text NOT NULL, document_id uuid, current_event_id uuid,
 current_version_id uuid, content_hash text
);
CREATE UNIQUE INDEX website_pages_url ON website_pages(team_id,website_id,url);
--> statement-breakpoint
-- Existing scan IDs and snapshots stay untouched. Never reprice historical captures.
INSERT INTO websites (team_id,url,hostname,subject,created_by,created_at)
 SELECT DISTINCT ON (s.team_id,s.url) s.team_id,s.url,substring(s.url FROM '^https?://([^/:]+)'),s.website_subject,
 COALESCE((SELECT r.author_user_id FROM raw_events r WHERE r.team_id=s.team_id AND r.source_metadata->>'websiteScanId'=s.id::text LIMIT 1),
 (SELECT m.user_id FROM team_members m WHERE m.team_id=s.team_id AND m.removed_at IS NULL ORDER BY m.created_at LIMIT 1)),s.created_at
 FROM website_sources s WHERE EXISTS (SELECT 1 FROM team_members m WHERE m.team_id=s.team_id AND m.removed_at IS NULL)
 ORDER BY s.team_id,s.url,s.created_at DESC;
INSERT INTO website_runs (id,team_id,website_id,requested_by,trigger,idempotency_key,status,billing_policy,units_per_page,page_count,source_units,created_at,finished_at)
 SELECT s.id,s.team_id,w.id,COALESCE((SELECT f.started_by_user_id FROM team_first_run f WHERE f.team_id=s.team_id AND f.website_scan_id=s.id),w.created_by),'onboarding','legacy:'||s.id,
 'completed','legacy',1,COALESCE(jsonb_array_length(s.pages),0),COALESCE(jsonb_array_length(s.pages),0),s.created_at,s.created_at
 FROM website_sources s JOIN websites w ON w.team_id=s.team_id AND w.url=s.url;

-- Queued onboarding jobs may not yet have a provider checkpoint.
INSERT INTO websites (team_id,url,hostname,subject,created_by,created_at)
 SELECT f.team_id,f.website_url,substring(f.website_url FROM '^https?://([^/:]+)'),f.website_subject,f.started_by_user_id,f.created_at
 FROM team_first_run f WHERE f.website_url IS NOT NULL AND f.started_by_user_id IS NOT NULL
 ON CONFLICT (team_id,url) WHERE archived_at IS NULL DO NOTHING;
INSERT INTO website_runs (id,team_id,website_id,requested_by,trigger,idempotency_key,status,billing_policy,units_per_page,failure_reason,created_at)
 SELECT f.website_scan_id,f.team_id,w.id,f.started_by_user_id,'onboarding','legacy:'||f.website_scan_id,'partial','legacy',1,'legacy_pending',f.updated_at
 FROM team_first_run f JOIN websites w ON w.team_id=f.team_id AND w.url=f.website_url
 WHERE f.website_scan_id IS NOT NULL AND f.started_by_user_id IS NOT NULL AND f.phase='processing'
 ON CONFLICT (id) DO UPDATE SET status='partial',finished_at=NULL,failure_reason='legacy_pending';

--> statement-breakpoint
ALTER TABLE document_chunks ADD COLUMN website_embedded_at timestamptz;
--> statement-breakpoint
INSERT INTO website_pages (team_id,website_id,url,document_id,current_event_id,current_version_id,content_hash)
 SELECT DISTINCT ON (w.team_id,w.id,r.source_metadata->>'pageUrl') w.team_id,w.id,r.source_metadata->>'pageUrl',d.id,r.id,v.id,v.checksum_sha256
 FROM websites w JOIN website_sources s ON s.team_id=w.team_id AND s.url=w.url
 JOIN raw_events r ON r.team_id=w.team_id AND r.source_metadata->>'websiteScanId'=s.id::text
 JOIN documents d ON d.team_id=w.team_id AND d.source_raw_event_id=r.id AND d.deleted_at IS NULL
 JOIN document_versions v ON v.team_id=w.team_id AND v.document_id=d.id AND v.id=d.current_version_id
 WHERE r.source_metadata->>'pageUrl' IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM team_first_run f WHERE f.team_id=w.team_id AND f.website_scan_id=s.id AND f.phase='processing')
 ORDER BY w.team_id,w.id,r.source_metadata->>'pageUrl',s.created_at DESC;
UPDATE website_runs r SET status='partial',failure_reason='legacy_pending',finished_at=NULL FROM website_sources s WHERE r.id=s.id AND s.pages IS NULL;
--> statement-breakpoint
CREATE TABLE website_notifications (run_id uuid PRIMARY KEY REFERENCES website_runs(id) ON DELETE CASCADE, team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE, ciphertext text NOT NULL, iv text NOT NULL, tag text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
