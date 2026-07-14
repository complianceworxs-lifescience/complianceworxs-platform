-- Step 1: Update constraint FIRST so auto_reply is valid
ALTER TABLE inbound_log DROP CONSTRAINT IF EXISTS inbound_log_sentiment_check;
ALTER TABLE inbound_log ADD CONSTRAINT inbound_log_sentiment_check 
  CHECK (sentiment IN ('positive','neutral','objection','negative','unclear','auto_reply'));

-- Step 2: Update trigger to skip Attio update on auto-replies
CREATE OR REPLACE FUNCTION queue_attio_after_reply()
RETURNS TRIGGER AS $$
DECLARE
    v_attio_id TEXT;
BEGIN
    SELECT attio_record_id INTO v_attio_id
    FROM warm_outbound_staging
    WHERE id = NEW.staging_id;

    IF v_attio_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.sentiment IS DISTINCT FROM 'auto_reply' THEN
        INSERT INTO attio_sync_queue (attio_record_id, object_type, update_payload, triggered_by)
        VALUES (
            v_attio_id,
            'people',
            jsonb_build_object('outreach_status', 'Replied'),
            'inbound_reply'
        );

        UPDATE warm_outbound_staging
        SET replied_at = NEW.received_at
        WHERE id = NEW.staging_id AND replied_at IS NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Migrate existing inbound_replies into inbound_log
INSERT INTO inbound_log (staging_id, attio_record_id, channel, received_at, reply_text, detected_by, sentiment, note)
SELECT 
  ir.staging_id,
  ir.attio_record_id,
  'email',
  ir.received_at,
  ir.body_plain,
  'gmail-reply-poller',
  CASE 
    WHEN ir.subject ILIKE 'Automatic reply%' OR ir.subject ILIKE 'Auto%reply%' 
         OR ir.subject ILIKE 'Out of office%' OR ir.body_plain ILIKE 'I am no longer%'
         OR ir.body_plain ILIKE 'no longer with%' OR ir.body_plain ILIKE 'mailbox is no longer%' THEN 'auto_reply'
    ELSE 'unclear'
  END,
  'Subject: ' || ir.subject
FROM inbound_replies ir
WHERE NOT EXISTS (
  SELECT 1 FROM inbound_log il 
  WHERE il.staging_id = ir.staging_id AND il.received_at = ir.received_at
);

-- Step 4: Departed-employee tracking
CREATE TABLE IF NOT EXISTS departed_employee_redirects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_staging_id BIGINT REFERENCES warm_outbound_staging(id),
    original_full_name TEXT,
    original_company TEXT,
    redirect_name TEXT,
    redirect_email TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actioned_at TIMESTAMPTZ,
    new_staging_id BIGINT REFERENCES warm_outbound_staging(id),
    note TEXT
);

-- Step 5: Archive the 3 dead leads
UPDATE warm_outbound_staging
SET archived_at = NOW(),
    archive_reason = 'departed_employee_auto_reply_2026_05_07'
WHERE id IN (556, 364, 365) AND archived_at IS NULL;

-- Step 6: Log the redirects for action
INSERT INTO departed_employee_redirects (original_staging_id, original_full_name, original_company, redirect_name, redirect_email, note)
VALUES
  (556, 'Shikha Nayyar', 'BVI Medical', 'Bhavin Mehta', 'BMehta@bvimedical.com', 'Auto-reply redirect 2026-05-07'),
  (364, 'Joseph Ross', 'Ultragenyx', 'Noah Buff', NULL, 'Auto-reply redirect — no email provided, search Phantombuster'),
  (365, 'Shannon Harrell', 'Daiichi Sankyo US', NULL, NULL, 'Mailbox dead, no redirect');