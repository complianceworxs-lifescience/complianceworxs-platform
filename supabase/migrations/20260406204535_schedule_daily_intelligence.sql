
-- Create the daily intelligence refresh function
CREATE OR REPLACE FUNCTION public.refresh_daily_intelligence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN

  -- Step 1: Refresh buyer_journey from events
  INSERT INTO public.buyer_journey
  SELECT
    session_id as user_id,
    COUNT(*) FILTER (WHERE event_name = 'lock_view'),
    COUNT(*) FILTER (WHERE event_name = 'cta_click'),
    COUNT(DISTINCT session_id),
    EXTRACT(EPOCH FROM (
      MAX(created_at) FILTER (WHERE event_name = 'purchase')
      - MIN(created_at)
    ))::INT,
    MIN(created_at),
    MAX(created_at) FILTER (WHERE event_name = 'purchase')
  FROM public.events
  WHERE session_id IS NOT NULL
  GROUP BY session_id
  ON CONFLICT (user_id) DO UPDATE
  SET
    num_lock_views = EXCLUDED.num_lock_views,
    num_cta_clicks = EXCLUDED.num_cta_clicks,
    num_sessions = EXCLUDED.num_sessions,
    time_to_purchase_seconds = EXCLUDED.time_to_purchase_seconds,
    purchase_event = EXCLUDED.purchase_event;

  -- Step 2: Update action_log outcomes from purchases
  UPDATE public.action_log al
  SET
    result = 'purchase',
    time_to_conversion_seconds = EXTRACT(EPOCH FROM (p.purchased_at - al.timestamp))::INT
  FROM public.purchases p
  WHERE al.user_id = p.email
  AND al.result IS NULL;

  -- Step 3: Recalibrate scoring
  UPDATE public.user_state
  SET conversion_probability =
    LEAST(1, GREATEST(0, (intent_score * 0.6 - hesitation_score * 0.4) / 100));

  -- Step 4: Update recency weights and priority scores
  UPDATE public.user_state SET
    recency_weight = GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (now() - last_seen_ts)) / 86400.0 / 30.0)),
    priority_score = ROUND((
      LEAST(1, GREATEST(0, (intent_score - hesitation_score) / 100.0))
      * GREATEST(0.1, 1.0 - (EXTRACT(EPOCH FROM (now() - last_seen_ts)) / 86400.0 / 30.0))
      * CASE WHEN hesitation_score > 0 THEN GREATEST(0.1, 1.0 - (hesitation_score / 200.0)) ELSE 1.0 END
    )::numeric, 4);

  -- Step 5: Write daily intelligence snapshot
  INSERT INTO public.daily_intelligence (
    total_revenue_cents,
    total_purchases,
    new_purchases_today,
    total_lock_views,
    total_cta_clicks,
    lock_to_cta_rate,
    cta_to_purchase_rate,
    high_intent_users,
    emails_captured,
    unconverted_cta_clicks,
    top_prospect_user_id,
    top_prospect_intent,
    top_prospect_last_action,
    top_prospect_last_seen,
    top_prospect_email,
    action_queue,
    avg_intent_score,
    avg_conversion_probability
  )
  SELECT
    (SELECT COUNT(*) * 14900 FROM purchases) as total_revenue_cents,
    (SELECT COUNT(*) FROM purchases) as total_purchases,
    (SELECT COUNT(*) FROM purchases WHERE purchased_at >= now() - interval '24 hours') as new_purchases_today,
    (SELECT COUNT(*) FROM events WHERE event_name = 'lock_view') as total_lock_views,
    (SELECT COUNT(*) FROM events WHERE event_name = 'cta_click') as total_cta_clicks,
    CASE WHEN (SELECT COUNT(*) FROM events WHERE event_name = 'lock_view') > 0
      THEN ROUND(((SELECT COUNT(*) FROM events WHERE event_name = 'cta_click')::numeric /
           (SELECT COUNT(*) FROM events WHERE event_name = 'lock_view')::numeric) * 100, 1)
      ELSE 0 END,
    CASE WHEN (SELECT COUNT(*) FROM events WHERE event_name = 'cta_click') > 0
      THEN ROUND(((SELECT COUNT(*) FROM purchases)::numeric /
           (SELECT COUNT(*) FROM events WHERE event_name = 'cta_click')::numeric) * 100, 1)
      ELSE 0 END,
    (SELECT COUNT(*) FROM user_state WHERE intent_score >= 70 AND purchases = 0),
    (SELECT COUNT(*) FROM leads WHERE email IS NOT NULL
      AND email NOT ILIKE '%complianceworxs%'
      AND email NOT ILIKE '%test%'),
    (SELECT COUNT(*) FROM user_state WHERE cta_clicks > 0 AND purchases = 0),
    (SELECT user_id FROM user_state WHERE purchases = 0 ORDER BY priority_score DESC LIMIT 1),
    (SELECT intent_score FROM user_state WHERE purchases = 0 ORDER BY priority_score DESC LIMIT 1),
    (SELECT last_action FROM user_state WHERE purchases = 0 ORDER BY priority_score DESC LIMIT 1),
    (SELECT last_seen_ts FROM user_state WHERE purchases = 0 ORDER BY priority_score DESC LIMIT 1),
    (SELECT l.email FROM leads l
     JOIN user_state us ON l.session_id = us.user_id
     WHERE us.purchases = 0
     ORDER BY us.priority_score DESC LIMIT 1),
    (SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', user_id,
        'intent', ROUND(intent_score::numeric, 0),
        'hesitation', ROUND(hesitation_score::numeric, 0),
        'cta_clicks', cta_clicks,
        'lock_views', locks_encountered,
        'visits', visits,
        'last_action', last_action,
        'priority', ROUND(priority_score::numeric, 3),
        'last_seen', last_seen_ts
      )
    ), '[]'::jsonb)
    FROM (
      SELECT * FROM user_state
      WHERE intent_score >= 40 AND purchases = 0
      ORDER BY priority_score DESC LIMIT 10
    ) q),
    (SELECT ROUND(AVG(intent_score)::numeric, 1) FROM user_state WHERE intent_score > 0),
    (SELECT ROUND(AVG(conversion_probability)::numeric, 3) FROM user_state WHERE conversion_probability > 0);

END;
$$;

-- Schedule it to run every day at 6am UTC (2am EST)
SELECT cron.schedule(
  'daily-intelligence-refresh',
  '0 6 * * *',
  'SELECT public.refresh_daily_intelligence()'
);
