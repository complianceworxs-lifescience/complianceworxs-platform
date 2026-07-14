-- PF-1B CATCH-UP MIGRATION (out-of-band recovery)
-- These objects existed in production (project balkvbmtummehgbbeqap) but were
-- created outside the migration history (SQL editor/dashboard). Captured here from
-- their live definitions so the migration set fully reproduces production.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE): safe to re-apply.

CREATE OR REPLACE VIEW public.v_revenue_daily AS  SELECT date_trunc('day'::text, (purchased_at AT TIME ZONE 'America/New_York'::text))::date AS day,
    count(*) AS orders,
    COALESCE(sum(amount_cents), 0::bigint)::numeric / 100.0 AS revenue_usd,
    array_agg(DISTINCT product_slug) FILTER (WHERE product_slug IS NOT NULL) AS products
   FROM orders
  WHERE order_status = 'completed'::text AND refunded_at IS NULL
  GROUP BY (date_trunc('day'::text, (purchased_at AT TIME ZONE 'America/New_York'::text))::date)
  ORDER BY (date_trunc('day'::text, (purchased_at AT TIME ZONE 'America/New_York'::text))::date) DESC;

