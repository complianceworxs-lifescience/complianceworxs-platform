-- Date-aware send budget schedule. Sender reads this table at runtime.
CREATE TABLE IF NOT EXISTS outbound_send_budget_schedule (
  effective_date DATE PRIMARY KEY,
  daily_budget INT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE outbound_send_budget_schedule IS
  'Daily send budget schedule. Sender uses budget for the most recent effective_date <= today. Add new rows to bump the cap.';

INSERT INTO outbound_send_budget_schedule (effective_date, daily_budget, notes) VALUES
  ('2026-05-03', 25, 'Initial cap during week-1 deliverability warmup'),
  ('2026-05-10', 50, 'Doubled after week-1 of clean sends')
ON CONFLICT (effective_date) DO UPDATE
SET daily_budget = EXCLUDED.daily_budget, notes = EXCLUDED.notes;