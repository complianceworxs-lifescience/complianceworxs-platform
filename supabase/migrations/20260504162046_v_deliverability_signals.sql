-- View consumed by daily-brief-generator. Window = last 7 days.
-- Row 1 (single row): summary metrics for "should we scale daily cap?"
CREATE OR REPLACE VIEW v_deliverability_signals AS
WITH last_7d AS (
  SELECT
    dispatched_at,
    delivery_status,
    bounce_type,
    SPLIT_PART(email, '@', 2) AS recipient_domain
  FROM warm_outbound_staging
  WHERE dispatched_at >= NOW() - INTERVAL '7 days'
    AND send_provider = 'gmail'
),
totals AS (
  SELECT
    COUNT(*)                                              AS sends_7d,
    COUNT(*) FILTER (WHERE delivery_status = 'sent')      AS delivered_7d,
    COUNT(*) FILTER (WHERE delivery_status = 'bounced'
                       OR bounce_type IS NOT NULL)        AS bounced_7d,
    COUNT(*) FILTER (WHERE delivery_status = 'complained') AS complained_7d
  FROM last_7d
),
today AS (
  SELECT
    COUNT(*)                                              AS sends_today,
    COUNT(*) FILTER (WHERE delivery_status = 'bounced'
                       OR bounce_type IS NOT NULL)        AS bounced_today
  FROM warm_outbound_staging
  WHERE dispatched_at::date = CURRENT_DATE
    AND send_provider = 'gmail'
),
yesterday AS (
  SELECT
    COUNT(*)                                              AS sends_yest,
    COUNT(*) FILTER (WHERE delivery_status = 'bounced'
                       OR bounce_type IS NOT NULL)        AS bounced_yest
  FROM warm_outbound_staging
  WHERE dispatched_at::date = CURRENT_DATE - INTERVAL '1 day'
    AND send_provider = 'gmail'
),
governor AS (
  SELECT
    COUNT(*)                                              AS decisions_total,
    COUNT(DISTINCT decision_date)                         AS days_with_decisions,
    COUNT(*) FILTER (WHERE recommendation = 'SCALE')      AS scale_recs,
    COUNT(*) FILTER (WHERE recommendation = 'KILL')       AS kill_recs
  FROM decision_log
)
SELECT
  totals.sends_7d,
  totals.delivered_7d,
  totals.bounced_7d,
  totals.complained_7d,
  CASE WHEN totals.sends_7d > 0
       THEN ROUND(100.0 * totals.bounced_7d / totals.sends_7d, 1)
       ELSE NULL END                                      AS bounce_rate_7d_pct,
  today.sends_today,
  today.bounced_today,
  yesterday.sends_yest,
  yesterday.bounced_yest,
  governor.decisions_total                                AS governor_decisions_total,
  governor.days_with_decisions                            AS governor_days_active,
  governor.scale_recs                                     AS governor_scale_recs,
  governor.kill_recs                                      AS governor_kill_recs,
  CASE
    WHEN totals.sends_7d < 50 THEN 'INSUFFICIENT_DATA'
    WHEN governor.days_with_decisions < 7 THEN 'GOVERNOR_NOT_READY'
    WHEN totals.sends_7d > 0
         AND (100.0 * totals.bounced_7d / totals.sends_7d) >= 8.0 THEN 'BLOCKED_BOUNCE_TOO_HIGH'
    WHEN governor.scale_recs = 0 THEN 'WAIT_NO_SCALE_SIGNAL'
    ELSE 'CLEAR_TO_SCALE'
  END                                                     AS scale_verdict,
  -- Top 3 bouncing domains (informational)
  (
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT('domain', recipient_domain, 'bounces', cnt)
           ORDER BY cnt DESC)
    FROM (
      SELECT recipient_domain, COUNT(*) AS cnt
      FROM last_7d
      WHERE delivery_status = 'bounced' OR bounce_type IS NOT NULL
      GROUP BY recipient_domain
      ORDER BY cnt DESC
      LIMIT 3
    ) top_bounce
  )                                                       AS top_bouncing_domains
FROM totals, today, yesterday, governor;