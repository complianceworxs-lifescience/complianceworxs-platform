
DROP VIEW IF EXISTS funnel_v;

CREATE VIEW funnel_v AS
WITH daily_events AS (
  SELECT
    date_trunc('day', created_at)                                                      AS day,
    count(*) FILTER (WHERE event_name = 'case_file_view')                             AS case_file_views,
    count(*) FILTER (WHERE event_name = 'lock_view')                                  AS lock_views,
    count(*) FILTER (WHERE event_name IN ('cta_click', 'direct_checkout_redirect'))   AS cta_clicks
  FROM events
  GROUP BY date_trunc('day', created_at)
),
daily_purchases AS (
  SELECT
    date_trunc('day', purchased_at) AS day,
    count(*)                        AS purchases
  FROM purchases
  GROUP BY date_trunc('day', purchased_at)
)
SELECT
  de.day,
  de.case_file_views,
  de.lock_views,
  de.cta_clicks,
  coalesce(dp.purchases, 0)                                                            AS purchases,
  round(coalesce(dp.purchases, 0)::numeric / NULLIF(de.lock_views, 0) * 100, 1)       AS lock_to_purchase_pct,
  round(de.cta_clicks::numeric / NULLIF(de.case_file_views, 0) * 100, 1)              AS view_to_click_pct
FROM daily_events de
LEFT JOIN daily_purchases dp ON dp.day = de.day
ORDER BY de.day DESC;
