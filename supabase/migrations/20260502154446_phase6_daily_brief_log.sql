-- Daily brief log: every 5am EST run writes one row.
-- Latest brief always available via daily_brief_latest view.
CREATE TABLE IF NOT EXISTS daily_brief_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  report_date date NOT NULL,                   -- the date the report COVERS (yesterday)

  -- Summary
  total_leads integer,
  new_leads_yesterday integer,

  -- Pipeline breakdown (the 5 stages user asked for)
  status_breakdown jsonb,                      -- {unprocessed, enriched_ready, in_sequence, engaged_replied, disqualified}

  -- PostHog heat
  hot_leads_24h jsonb,                         -- contacts in CRM who visited site in last 24h
  high_value_actions jsonb,                    -- pricing/docs/signup hits

  -- Data quality
  enrichment_success_rate jsonb,               -- {found, attempted, percentage}
  bounce_rate jsonb,                           -- {bounced, sent, percentage}

  -- Golden 5
  golden_5 jsonb,                              -- prioritized list of 5 leads

  -- Revenue lens
  revenue_optimization jsonb,                  -- recommendations from data

  raw_payload jsonb,                           -- full debug payload
  duration_ms integer
);

CREATE INDEX IF NOT EXISTS idx_daily_brief_log_date ON daily_brief_log(report_date DESC);

CREATE OR REPLACE VIEW daily_brief_latest AS
SELECT * FROM daily_brief_log ORDER BY generated_at DESC LIMIT 1;

CREATE OR REPLACE VIEW daily_brief_history AS
SELECT report_date, generated_at, total_leads, new_leads_yesterday,
       status_breakdown, enrichment_success_rate, bounce_rate
FROM daily_brief_log ORDER BY report_date DESC LIMIT 30;