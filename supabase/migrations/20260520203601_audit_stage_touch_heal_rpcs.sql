
CREATE OR REPLACE FUNCTION count_stage_touch_mismatch()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM warm_outbound_staging w
  WHERE w.followup_stage LIKE 'followup_%_due'
    AND w.replied_at IS NULL
    AND w.archived_at IS NULL
    AND w.followup_drafts IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(w.followup_drafts) d
      WHERE (d->>'touch_number')::int = 
        CASE w.followup_stage
          WHEN 'followup_1_due' THEN 1
          WHEN 'followup_2_due' THEN 2
          WHEN 'followup_3_due' THEN 3
          WHEN 'followup_4_due' THEN 4
          WHEN 'followup_5_due' THEN 5
          WHEN 'followup_6_due' THEN 6
          WHEN 'followup_7_due' THEN 7
        END
      AND d->>'status' = 'sent'
    );
$$;

CREATE OR REPLACE FUNCTION fix_stage_touch_mismatch()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  WITH updated AS (
    UPDATE warm_outbound_staging w
    SET followup_stage = 
      CASE w.followup_stage
        WHEN 'followup_1_due' THEN 'followup_2_due'
        WHEN 'followup_2_due' THEN 'followup_3_due'
        WHEN 'followup_3_due' THEN 'followup_4_due'
        WHEN 'followup_4_due' THEN 'followup_5_due'
        WHEN 'followup_5_due' THEN 'followup_6_due'
        WHEN 'followup_6_due' THEN 'followup_7_due'
        WHEN 'followup_7_due' THEN 'breakup_due'
        ELSE w.followup_stage
      END
    WHERE w.followup_stage LIKE 'followup_%_due'
      AND w.replied_at IS NULL
      AND w.archived_at IS NULL
      AND w.followup_drafts IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(w.followup_drafts) d
        WHERE (d->>'touch_number')::int = 
          CASE w.followup_stage
            WHEN 'followup_1_due' THEN 1
            WHEN 'followup_2_due' THEN 2
            WHEN 'followup_3_due' THEN 3
            WHEN 'followup_4_due' THEN 4
            WHEN 'followup_5_due' THEN 5
            WHEN 'followup_6_due' THEN 6
            WHEN 'followup_7_due' THEN 7
          END
        AND d->>'status' = 'sent'
      )
    RETURNING 1
  )
  SELECT COUNT(*)::bigint INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION count_stage_touch_mismatch() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION fix_stage_touch_mismatch() TO service_role, authenticated;
