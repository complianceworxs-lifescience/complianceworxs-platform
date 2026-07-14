-- Backfill correction: where the only inbound is an auto_reply, clear the false replied_at signal
UPDATE warm_outbound_staging s
SET replied_at = NULL,
    followup_stage = CASE
      WHEN followup_stage = 'replied' THEN NULL
      ELSE followup_stage
    END
WHERE s.id IN (
  SELECT s2.id
  FROM warm_outbound_staging s2
  JOIN inbound_log i ON i.staging_id = s2.id
  WHERE s2.replied_at IS NOT NULL
  GROUP BY s2.id
  HAVING bool_and(i.sentiment = 'auto_reply') = true
);