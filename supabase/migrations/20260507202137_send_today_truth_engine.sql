-- 1. The truth table
CREATE TABLE IF NOT EXISTS outbound_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staging_id BIGINT REFERENCES warm_outbound_staging(id),
    attio_record_id TEXT,
    channel TEXT CHECK (channel IN ('linkedin_dm', 'email')),
    touch_number INTEGER NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_by TEXT NOT NULL DEFAULT 'manual',
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbound_log_staging_id ON outbound_log(staging_id);
CREATE INDEX IF NOT EXISTS idx_outbound_log_sent_at ON outbound_log(sent_at DESC);

-- 2. Reconciliation: re-qualify the 16 false-negative Disqualified records
UPDATE warm_outbound_staging
SET last_attio_status = NULL
WHERE id IN (373, 201, 180, 259, 8, 363, 192, 4, 80, 389, 364, 189, 429, 12, 357, 93)
  AND last_attio_status = 'Disqualified';

-- Lorenzo Fortibuoni — genuine kill
UPDATE warm_outbound_staging
SET archived_at = NOW(),
    archive_reason = 'sweep_2026_05_07: Supply Chain Manager not QA/buyer'
WHERE id = 367;

-- 3. The single source of truth view
CREATE OR REPLACE VIEW send_today AS
WITH lead_history AS (
    SELECT
        staging_id,
        MAX(touch_number) AS last_touch_number,
        MAX(sent_at) AS last_sent_at,
        MAX(channel) FILTER (WHERE sent_at = (SELECT MAX(sent_at) FROM outbound_log l2 WHERE l2.staging_id = outbound_log.staging_id)) AS last_channel,
        MAX(sent_at) FILTER (WHERE touch_number >= 3) AS last_breakup_at
    FROM outbound_log
    GROUP BY staging_id
),
ranked_leads AS (
    SELECT
        s.id AS staging_id,
        s.full_name,
        s.company,
        s.job_title,
        s.linkedin_url,
        s.email,
        s.fit_score,
        s.attio_record_id,
        s.automation_paused_reason,
        ta.priority_score AS company_priority,
        ta.likely_quality_pressure AS inspection_signal,
        ta.best_fit_decision_record AS case_file_hook,
        ta.subsegment,
        COALESCE(h.last_touch_number, 0) + 1 AS next_touch,
        h.last_sent_at,
        h.last_channel,
        EXTRACT(epoch FROM (NOW() - h.last_sent_at))/86400 AS days_since_touch,
        CASE
            WHEN s.linkedin_url IS NOT NULL AND COALESCE(h.last_touch_number, 0) = 0 THEN 'linkedin_dm'
            WHEN s.linkedin_url IS NOT NULL AND COALESCE(h.last_touch_number, 0) = 1 AND h.last_channel = 'linkedin_dm' AND s.email IS NOT NULL THEN 'email'
            WHEN s.linkedin_url IS NOT NULL THEN 'linkedin_dm'
            WHEN s.email IS NOT NULL THEN 'email'
            ELSE NULL
        END AS recommended_channel,
        COALESCE(
            split_part(s.email, '@', 2),
            lower(regexp_replace(s.company, '[^a-zA-Z0-9]', '', 'g'))
        ) AS partition_key,
        (s.fit_score + COALESCE(ta.priority_score, 0)) AS priority_score
    FROM warm_outbound_staging s
    LEFT JOIN target_accounts ta ON lower(s.company) = lower(ta.company_name)
    LEFT JOIN lead_history h ON h.staging_id = s.id
    WHERE
        s.archived_at IS NULL
        AND s.replied_at IS NULL
        AND s.fit_score >= 75
        AND COALESCE(s.last_attio_status, '') NOT IN ('Disqualified', 'Purchased')
        AND (s.linkedin_url IS NOT NULL OR s.email IS NOT NULL)
        AND (h.last_breakup_at IS NULL OR h.last_breakup_at < NOW() - INTERVAL '90 days')
        AND (
            h.last_sent_at IS NULL
            OR (h.last_channel = 'linkedin_dm' AND h.last_sent_at < NOW() - INTERVAL '3 days')
            OR (h.last_channel = 'email' AND h.last_sent_at < NOW() - INTERVAL '4 days')
        )
        AND (s.automation_paused = false OR s.automation_paused_reason ILIKE '%LinkedIn DM workflow%')
)
SELECT
    staging_id,
    full_name,
    company,
    job_title,
    linkedin_url,
    email,
    recommended_channel,
    next_touch,
    last_sent_at,
    days_since_touch,
    fit_score,
    company_priority,
    priority_score,
    inspection_signal,
    case_file_hook,
    subsegment,
    attio_record_id,
    ROW_NUMBER() OVER (ORDER BY priority_score DESC, fit_score DESC) AS priority_rank
FROM (
    SELECT *,
        ROW_NUMBER() OVER (PARTITION BY partition_key ORDER BY priority_score DESC, fit_score DESC) AS domain_rank
    FROM ranked_leads
    WHERE recommended_channel IS NOT NULL
) deduped
WHERE domain_rank = 1
ORDER BY priority_score DESC, fit_score DESC
LIMIT 25;