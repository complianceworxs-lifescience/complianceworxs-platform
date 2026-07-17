-- CW-MDR-008 M8 build step 4 (M8-03/M8-05, D8-3) — demote the irr-stage-engine cron to
-- RECOVERY-ONLY.
--
-- Normal stage advancement is now worker-owned: the engine drives consecutive stages in one
-- background invocation and self-reinvokes across the time budget (build step 3), and generate-irr
-- fires a first-touch kick on enqueue (build step 4 / D8-2). This cron is therefore no longer the
-- driver of normal execution — it is a periodic RECOVERY SWEEP: each tick claims the
-- least-recently-updated eligible job and resumes it, which recovers (a) jobs whose worker died
-- mid-flight — the claim's 380s in-flight guard releases the stuck stage once it is stale, then the
-- engine resumes at highestCompleted+1 from the persisted checkpoint — and (b) any freshly-queued
-- job whose first-touch kick was dropped. A healthy, actively-driven job has a fresh (<380s)
-- running stage, so the claim SKIPS it: cron does not advance healthy jobs.
--
-- Cadence: 1 minute (D8-3). This also RECONCILES a schedule drift: the committed migration
-- 20260710113839 set '* * * * *' (1 min), but the deployed cron had been hand-edited out-of-band to
-- '30 seconds'. Re-running cron.schedule under the same job name replaces the live schedule, making
-- this committed migration the single source of truth again (no further hand-edits to prod cron).
--
-- Orphan-recovery window ≈ 380s (in-flight guard, the max a legitimate batched stage may run) +
-- up to the 1-min cadence. This is a rare-crash safety net; the <5-min latency metric governs the
-- healthy hot path (worker-owned, no cron), not recovery.

SELECT cron.schedule(
  'irr-stage-engine-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/irr-stage-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )
  $$
);
