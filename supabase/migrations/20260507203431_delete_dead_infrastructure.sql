-- Drop dead tables/views that no longer feed any active workflow
DROP TABLE IF EXISTS linkedin_dm_send_queue CASCADE;
DROP TABLE IF EXISTS attio_task_chase_log CASCADE;
DROP VIEW IF EXISTS linkedin_dm_phantom_feed CASCADE;
DROP VIEW IF EXISTS linkedin_dm_approval_queue CASCADE;
DROP VIEW IF EXISTS stale_attio_tasks CASCADE;
DROP VIEW IF EXISTS session_start_briefing CASCADE;
DROP VIEW IF EXISTS phantom_sends CASCADE;
DROP VIEW IF EXISTS stuck_positive_replies CASCADE;
DROP VIEW IF EXISTS conversion_focus_today CASCADE;