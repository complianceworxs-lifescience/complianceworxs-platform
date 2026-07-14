-- Fix queue_attio_after_send: outreach_status was 'Engaged' (invalid) → must be 'Emailed' (valid Attio status option).
CREATE OR REPLACE FUNCTION public.queue_attio_after_send()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
        jsonb_build_object('outreach_status', 'Emailed'),
        'outbound_send'
    );

    RETURN NEW;
END;
$$;