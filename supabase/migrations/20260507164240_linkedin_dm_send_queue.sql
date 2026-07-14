-- LinkedIn DM Send Queue
-- Phantombuster's LinkedIn Message Sender phantom reads from a Google Sheet
-- that mirrors this table. The phantom expects two columns: profileUrl, message.
-- We add operational columns for our own scheduling, dedup, throttling, and audit.

CREATE TABLE IF NOT EXISTS linkedin_dm_send_queue (
  id BIGSERIAL PRIMARY KEY,
  
  -- Phantom-required fields (these are what the phantom reads)
  profile_url TEXT NOT NULL,
  message TEXT NOT NULL,
  
  -- Identity / linkage
  full_name TEXT,
  contact_email TEXT,
  staging_id BIGINT,
  attio_record_id UUID,
  campaign_tag TEXT,           -- e.g. 'first_dm', 'followup_dm_2', 'reactivation'
  
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | skipped | failed
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  send_provider TEXT,                     -- 'phantombuster' when sent
  send_error TEXT,
  send_attempt_count INT DEFAULT 0,
  
  -- Throttling / budget — Phantombuster sender max ~50/day, we cap at 25
  send_date_assigned DATE,                -- which day's budget this row is using
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT DEFAULT 'system',
  approved_by_jon BOOLEAN DEFAULT FALSE,  -- safety gate so DMs don't fire without review
  approved_at TIMESTAMPTZ,
  notes TEXT,
  
  CONSTRAINT valid_status CHECK (status IN ('queued','sent','skipped','failed','draft','paused'))
);

CREATE INDEX IF NOT EXISTS idx_dm_queue_status ON linkedin_dm_send_queue(status);
CREATE INDEX IF NOT EXISTS idx_dm_queue_scheduled ON linkedin_dm_send_queue(scheduled_for) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_dm_queue_staging ON linkedin_dm_send_queue(staging_id);
CREATE INDEX IF NOT EXISTS idx_dm_queue_attio ON linkedin_dm_send_queue(attio_record_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dm_queue_dedup ON linkedin_dm_send_queue(profile_url, campaign_tag) 
  WHERE status IN ('queued','sent');

-- View that mirrors what the phantom needs — only approved + due rows
CREATE OR REPLACE VIEW linkedin_dm_phantom_feed AS
SELECT 
  id,
  profile_url AS "profileUrl",
  message AS "message",
  full_name AS "fullName",
  campaign_tag AS "campaign"
FROM linkedin_dm_send_queue
WHERE status = 'queued'
  AND approved_by_jon = TRUE
  AND scheduled_for <= NOW()
ORDER BY scheduled_for ASC
LIMIT 25;  -- Daily budget cap

-- View for Jon's daily approval queue — what's drafted but not approved
CREATE OR REPLACE VIEW linkedin_dm_approval_queue AS
SELECT 
  q.id,
  q.full_name,
  q.profile_url,
  q.campaign_tag,
  q.message,
  q.scheduled_for,
  q.notes,
  q.created_at
FROM linkedin_dm_send_queue q
WHERE q.status IN ('queued','draft')
  AND q.approved_by_jon = FALSE
ORDER BY q.created_at ASC;

COMMENT ON TABLE linkedin_dm_send_queue IS 'Outbound LinkedIn DM queue. Phantombuster LinkedIn Message Sender phantom reads from linkedin_dm_phantom_feed view (approved+due rows only). Status flips to sent when phantombuster_webhook fires with success.';