-- 1. Reply log: every detected inbound from a contacted lead
CREATE TABLE IF NOT EXISTS inbound_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staging_id BIGINT REFERENCES warm_outbound_staging(id),
    attio_record_id TEXT,
    channel TEXT CHECK (channel IN ('linkedin_dm', 'email')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reply_text TEXT,
    detected_by TEXT NOT NULL DEFAULT 'manual_paste',
    sentiment TEXT CHECK (sentiment IN ('positive','neutral','objection','negative','unclear')),
    next_step_protocol TEXT,
    handled_at TIMESTAMPTZ,
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbound_log_staging_id ON inbound_log(staging_id);
CREATE INDEX IF NOT EXISTS idx_inbound_log_handled ON inbound_log(handled_at) WHERE handled_at IS NULL;

-- 2. The advance_today view: every contacted lead in flight, with next-action computed
CREATE OR REPLACE VIEW advance_today AS
WITH lead_state AS (
    SELECT
        s.id AS staging_id,
        s.full_name,
        s.company,
        s.job_title,
        s.linkedin_url,
        s.email,
        s.fit_score,
        s.attio_record_id,
        s.replied_at,
        ta.best_fit_decision_record AS case_file_hook,
        ta.likely_quality_pressure AS inspection_signal,
        -- Outbound history
        ol.last_touch_number,
        ol.last_sent_at,
        ol.last_channel,
        ol.total_touches,
        -- Inbound history
        il.last_reply_at,
        il.last_reply_text,
        il.last_sentiment,
        il.unhandled_replies
    FROM warm_outbound_staging s
    LEFT JOIN target_accounts ta ON lower(s.company) = lower(ta.company_name)
    LEFT JOIN LATERAL (
        SELECT
            MAX(touch_number) AS last_touch_number,
            MAX(sent_at) AS last_sent_at,
            MAX(channel) FILTER (WHERE sent_at = (SELECT MAX(sent_at) FROM outbound_log l2 WHERE l2.staging_id = s.id)) AS last_channel,
            COUNT(*) AS total_touches
        FROM outbound_log
        WHERE staging_id = s.id
    ) ol ON true
    LEFT JOIN LATERAL (
        SELECT
            MAX(received_at) AS last_reply_at,
            MAX(reply_text) FILTER (WHERE received_at = (SELECT MAX(received_at) FROM inbound_log i2 WHERE i2.staging_id = s.id)) AS last_reply_text,
            MAX(sentiment) FILTER (WHERE received_at = (SELECT MAX(received_at) FROM inbound_log i2 WHERE i2.staging_id = s.id)) AS last_sentiment,
            COUNT(*) FILTER (WHERE handled_at IS NULL) AS unhandled_replies
        FROM inbound_log
        WHERE staging_id = s.id
    ) il ON true
    WHERE s.archived_at IS NULL
      AND ol.last_sent_at IS NOT NULL  -- must have been contacted
      AND COALESCE(s.last_attio_status, '') NOT IN ('Disqualified', 'Purchased')
)
SELECT
    staging_id,
    full_name,
    company,
    job_title,
    linkedin_url,
    email,
    fit_score,
    attio_record_id,
    case_file_hook,
    inspection_signal,
    last_touch_number,
    last_sent_at,
    last_channel,
    total_touches,
    last_reply_at,
    last_reply_text,
    last_sentiment,
    unhandled_replies,
    EXTRACT(epoch FROM (NOW() - last_sent_at))/86400 AS days_since_sent,
    EXTRACT(epoch FROM (NOW() - last_reply_at))/86400 AS days_since_reply,
    -- Next-action computation
    CASE
        -- Replied, unhandled → reply protocol
        WHEN unhandled_replies > 0 THEN 'reply_pending'
        -- Replied, already handled → wait for them
        WHEN last_reply_at IS NOT NULL AND last_reply_at > last_sent_at THEN 'awaiting_buyer'
        -- We sent last, conversation alive → followup ladder
        WHEN last_reply_at IS NOT NULL AND last_sent_at > last_reply_at AND NOW() - last_sent_at > INTERVAL '3 days' THEN 'silence_day_3'
        WHEN last_reply_at IS NOT NULL AND last_sent_at > last_reply_at AND NOW() - last_sent_at > INTERVAL '7 days' THEN 'silence_day_7'
        WHEN last_reply_at IS NOT NULL AND last_sent_at > last_reply_at AND NOW() - last_sent_at > INTERVAL '14 days' THEN 'silence_day_14_breakup'
        -- Never replied, follow-up cadence by touch number
        WHEN last_touch_number = 1 AND last_channel = 'linkedin_dm' AND NOW() - last_sent_at >= INTERVAL '3 days' THEN 'cold_followup_2'
        WHEN last_touch_number = 1 AND last_channel = 'email' AND NOW() - last_sent_at >= INTERVAL '4 days' THEN 'cold_followup_2'
        WHEN last_touch_number = 2 AND NOW() - last_sent_at >= INTERVAL '5 days' THEN 'cold_followup_3_breakup'
        WHEN last_touch_number >= 3 AND NOW() - last_sent_at >= INTERVAL '90 days' THEN 'cold_revive'
        WHEN last_touch_number = 1 AND last_channel = 'linkedin_dm' AND NOW() - last_sent_at < INTERVAL '3 days' THEN 'wait'
        WHEN last_touch_number = 1 AND last_channel = 'email' AND NOW() - last_sent_at < INTERVAL '4 days' THEN 'wait'
        WHEN last_touch_number = 2 AND NOW() - last_sent_at < INTERVAL '5 days' THEN 'wait'
        ELSE 'review'
    END AS next_action,
    -- Priority for daily list
    CASE
        WHEN unhandled_replies > 0 THEN 1                                                           -- replies first
        WHEN last_reply_at IS NOT NULL AND last_sent_at > last_reply_at 
             AND NOW() - last_sent_at > INTERVAL '7 days' THEN 2                                    -- post-conversation silence
        WHEN last_touch_number = 2 AND NOW() - last_sent_at >= INTERVAL '5 days' THEN 3             -- ready for breakup
        WHEN last_touch_number = 1 AND NOW() - last_sent_at >= 
             CASE WHEN last_channel = 'linkedin_dm' THEN INTERVAL '3 days' ELSE INTERVAL '4 days' END THEN 4
        WHEN last_touch_number >= 3 AND NOW() - last_sent_at >= INTERVAL '90 days' THEN 5           -- 90-day revive
        ELSE 99
    END AS action_priority
FROM lead_state
WHERE 
    -- Surface only leads needing action; hide 'wait' rows
    NOT (
        (last_touch_number = 1 AND last_channel = 'linkedin_dm' AND NOW() - last_sent_at < INTERVAL '3 days')
        OR (last_touch_number = 1 AND last_channel = 'email' AND NOW() - last_sent_at < INTERVAL '4 days')
        OR (last_touch_number = 2 AND NOW() - last_sent_at < INTERVAL '5 days')
        OR (last_touch_number >= 3 AND last_reply_at IS NULL AND NOW() - last_sent_at < INTERVAL '90 days')
    )
ORDER BY action_priority ASC, last_sent_at ASC;