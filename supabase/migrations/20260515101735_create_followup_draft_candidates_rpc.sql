
CREATE OR REPLACE FUNCTION fetch_followup_draft_candidates(p_limit int DEFAULT 25)
RETURNS TABLE (
  id bigint,
  full_name text,
  email text,
  job_title text,
  company text,
  industry text,
  fit_score int,
  attio_record_id text,
  first_touch_draft_subject text,
  first_touch_draft_body text,
  sequence_email_count int,
  followup_stage text,
  followup_drafts jsonb,
  next_followup_due_at timestamptz,
  dispatched_at timestamptz,
  send_message_id text,
  case_file_interest text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.full_name,
    s.email,
    s.job_title,
    s.company,
    s.industry,
    s.fit_score,
    s.attio_record_id,
    s.first_touch_draft_subject,
    s.first_touch_draft_body,
    s.sequence_email_count,
    s.followup_stage,
    s.followup_drafts,
    s.next_followup_due_at,
    s.dispatched_at,
    s.send_message_id,
    s.case_file_interest
  FROM warm_outbound_staging s
  WHERE s.next_followup_due_at <= NOW()
    AND s.replied_at IS NULL
    AND s.automation_paused = false
    AND s.archived_at IS NULL
    AND s.followup_completed_at IS NULL
    AND s.is_paying_customer = false
    AND s.dispatched_at IS NOT NULL
    AND s.send_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(s.followup_drafts, '[]'::jsonb)) AS d
      WHERE (d->>'touch_number')::int = 
        COALESCE(
          NULLIF(SUBSTRING(s.followup_stage FROM 'followup_(\d+)_due'), '')::int,
          1
        )
    )
  ORDER BY s.next_followup_due_at ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION fetch_followup_draft_candidates(int) TO service_role;
GRANT EXECUTE ON FUNCTION fetch_followup_draft_candidates(int) TO authenticated;
GRANT EXECUTE ON FUNCTION fetch_followup_draft_candidates(int) TO anon;
