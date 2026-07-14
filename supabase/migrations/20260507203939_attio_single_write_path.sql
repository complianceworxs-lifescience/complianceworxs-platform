-- ===========================================================================
-- ATTIO SINGLE WRITE PATH
-- 
-- Rule: Attio is a downstream mirror of outbound_log + inbound_log + warm_outbound_staging.
-- Nothing writes to Attio except the sync function below, and that function only 
-- runs in response to a logged action (send or reply). No sweep theater. No 
-- speculative status changes. No promoted-but-empty company shells.
-- 
-- Architecture:
--   outbound_log INSERT  → trigger → calls attio-sync edge function
--   inbound_log INSERT   → trigger → calls attio-sync edge function
--   target_accounts becomes attio company ONLY when a person at that company 
--     gets logged. No more pre-emptive company promotion.
-- ===========================================================================

-- 1. Outbound queue: holds Attio updates pending sync (deduped, replayable)
CREATE TABLE IF NOT EXISTS attio_sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attio_record_id TEXT NOT NULL,
    object_type TEXT NOT NULL CHECK (object_type IN ('people', 'companies')),
    update_payload JSONB NOT NULL,
    triggered_by TEXT NOT NULL CHECK (triggered_by IN ('outbound_send','inbound_reply','manual')),
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed')),
    error_msg TEXT,
    retry_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attio_sync_queue_pending 
    ON attio_sync_queue(sync_status, triggered_at) 
    WHERE sync_status = 'pending';

-- 2. Trigger function: when outbound_log gets a row, queue an Attio update
CREATE OR REPLACE FUNCTION queue_attio_after_send()
RETURNS TRIGGER AS $$
DECLARE
    v_attio_id TEXT;
BEGIN
    -- Find the Attio record_id from staging
    SELECT attio_record_id INTO v_attio_id
    FROM warm_outbound_staging
    WHERE id = NEW.staging_id;

    -- Skip if no Attio record exists
    IF v_attio_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Queue the Engaged status update
    INSERT INTO attio_sync_queue (attio_record_id, object_type, update_payload, triggered_by)
    VALUES (
        v_attio_id,
        'people',
        jsonb_build_object('outreach_status', 'Engaged'),
        'outbound_send'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_queue_attio_after_send ON outbound_log;
CREATE TRIGGER trg_queue_attio_after_send
    AFTER INSERT ON outbound_log
    FOR EACH ROW
    EXECUTE FUNCTION queue_attio_after_send();

-- 3. Trigger function: when inbound_log gets a row, queue Replied status
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

    INSERT INTO attio_sync_queue (attio_record_id, object_type, update_payload, triggered_by)
    VALUES (
        v_attio_id,
        'people',
        jsonb_build_object('outreach_status', 'Replied'),
        'inbound_reply'
    );

    -- Also flip replied_at on staging so this lead exits send_today
    UPDATE warm_outbound_staging
    SET replied_at = NEW.received_at
    WHERE id = NEW.staging_id AND replied_at IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_queue_attio_after_reply ON inbound_log;
CREATE TRIGGER trg_queue_attio_after_reply
    AFTER INSERT ON inbound_log
    FOR EACH ROW
    EXECUTE FUNCTION queue_attio_after_reply();

-- 4. Health view: see what's stuck in sync
CREATE OR REPLACE VIEW attio_sync_health AS
SELECT 
    sync_status,
    triggered_by,
    count(*) AS rows,
    MIN(triggered_at) AS oldest_pending,
    MAX(triggered_at) AS newest
FROM attio_sync_queue
GROUP BY sync_status, triggered_by
ORDER BY sync_status, triggered_by;