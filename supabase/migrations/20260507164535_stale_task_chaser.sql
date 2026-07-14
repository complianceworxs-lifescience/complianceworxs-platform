-- The reason tasks rot: nothing flags them. Building the flag.
-- Daily Supabase cron pulls all open Attio tasks via the API,
-- joins to a local task_chase_log table, and writes a "stale" flag
-- to the daily brief when a task is >48h past its deadline_at.

CREATE TABLE IF NOT EXISTS attio_task_chase_log (
  attio_task_id UUID PRIMARY KEY,
  content_preview TEXT,
  deadline_at TIMESTAMPTZ,
  created_at_attio TIMESTAMPTZ,
  linked_record_id UUID,
  classification TEXT,           -- 'auto_executable' | 'jon_only' | 'unknown'
  staleness_hours INT,
  first_chased_at TIMESTAMPTZ,
  last_chased_at TIMESTAMPTZ,
  chase_count INT DEFAULT 0,
  resolution TEXT,               -- 'completed' | 'killed' | 'still_open'
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chase_log_open ON attio_task_chase_log(deadline_at) 
  WHERE resolution IS NULL OR resolution = 'still_open';

-- View: stale tasks (deadline >48h ago, still open)
CREATE OR REPLACE VIEW stale_attio_tasks AS
SELECT 
  attio_task_id,
  content_preview,
  deadline_at,
  classification,
  staleness_hours,
  chase_count,
  CASE 
    WHEN staleness_hours > 168 THEN 'CRITICAL: 7+ days overdue'
    WHEN staleness_hours > 72  THEN 'HIGH: 3+ days overdue'
    WHEN staleness_hours > 48  THEN 'WARN: 2+ days overdue'
    ELSE 'fresh'
  END AS severity,
  CASE classification
    WHEN 'jon_only' THEN '⚠ Manual: only Jon can do this'
    WHEN 'auto_executable' THEN '🤖 Claude can execute this'
    ELSE '? Classify needed'
  END AS action_owner
FROM attio_task_chase_log
WHERE (resolution IS NULL OR resolution = 'still_open')
  AND staleness_hours > 48
ORDER BY staleness_hours DESC;

COMMENT ON VIEW stale_attio_tasks IS 'Daily brief surfaces these. Tasks Jon must act on or kill, tasks Claude can auto-execute on next session.';