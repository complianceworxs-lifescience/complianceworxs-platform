-- Function: log a manual LinkedIn DM that was sent outside the dm-dispatcher
-- Usage: SELECT log_manual_dm(240, 'Step 2 qualifier asking which authorization domain feels most exposed');
-- Or with specific timestamp: SELECT log_manual_dm(240, 'Re-engage attempt', '2026-05-15 14:30:00+00');
-- Returns: updated row summary

CREATE OR REPLACE FUNCTION log_manual_dm(
  p_staging_id BIGINT,
  p_dm_note TEXT DEFAULT NULL,
  p_sent_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  id BIGINT,
  contact TEXT,
  manual_dm_count INT,
  last_manual_dm_at TIMESTAMPTZ,
  dm_status TEXT,
  automation_paused BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_count INT;
BEGIN
  -- Get current count (stored in followup_stage as a parseable string or default 0)
  -- We use the dm_status field convention: 'sent_manual' or 'sent_manual_3x' etc.
  -- Simpler: store count in a dedicated column if we add one, otherwise use ingest_payload JSONB
  
  -- Get current manual DM count from ingest_payload (or initialize)
  SELECT COALESCE((ingest_payload->>'manual_dm_count')::INT, 0)
  INTO v_current_count
  FROM warm_outbound_staging
  WHERE warm_outbound_staging.id = p_staging_id;
  
  -- Increment + update
  UPDATE warm_outbound_staging
  SET
    dm_status = 'sent_manual',
    dm_first_message_sent_at = COALESCE(dm_first_message_sent_at, p_sent_at),
    ingest_payload = COALESCE(ingest_payload, '{}'::jsonb) || jsonb_build_object(
      'manual_dm_count', v_current_count + 1,
      'last_manual_dm_at', p_sent_at,
      'last_manual_dm_note', p_dm_note
    ),
    -- Auto-clear awaiting-human state when manual DM is sent
    automation_paused = FALSE,
    automation_paused_reason = CASE 
      WHEN automation_paused_reason ILIKE '%awaiting_human%' THEN NULL 
      ELSE automation_paused_reason 
    END,
    followup_completed_at = p_sent_at,
    followup_stage = 'manual_dm_' || (v_current_count + 1) || 'x'
  WHERE warm_outbound_staging.id = p_staging_id;

  -- Return summary
  RETURN QUERY
  SELECT 
    ws.id,
    (ws.first_name || ' ' || ws.last_name)::TEXT as contact,
    (ws.ingest_payload->>'manual_dm_count')::INT as manual_dm_count,
    (ws.ingest_payload->>'last_manual_dm_at')::TIMESTAMPTZ as last_manual_dm_at,
    ws.dm_status,
    ws.automation_paused
  FROM warm_outbound_staging ws
  WHERE ws.id = p_staging_id;
END;
$$;

COMMENT ON FUNCTION log_manual_dm IS 
'Logs a manual LinkedIn DM that was sent outside the dm-dispatcher. 
Increments manual_dm_count in ingest_payload, clears awaiting-human state, and updates followup_stage. 
Usage: SELECT * FROM log_manual_dm(staging_id, ''note about the DM''); 
With timestamp: SELECT * FROM log_manual_dm(staging_id, ''note'', ''2026-05-15 14:30:00+00''::timestamptz);';