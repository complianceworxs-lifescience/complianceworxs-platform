-- Add notified_at columns so lifecycle function doesn't spam duplicate notes
ALTER TABLE customer_lifecycle ADD COLUMN IF NOT EXISTS day_7_notified_at TIMESTAMPTZ;
ALTER TABLE customer_lifecycle ADD COLUMN IF NOT EXISTS day_14_notified_at TIMESTAMPTZ;
ALTER TABLE customer_lifecycle ADD COLUMN IF NOT EXISTS day_30_notified_at TIMESTAMPTZ;
ALTER TABLE customer_lifecycle ADD COLUMN IF NOT EXISTS day_60_notified_at TIMESTAMPTZ;
ALTER TABLE customer_lifecycle ADD COLUMN IF NOT EXISTS day_90_notified_at TIMESTAMPTZ;

-- Backfill: Carissa has already been notified for Day 14 (three times). Mark as notified.
UPDATE customer_lifecycle 
SET day_14_notified_at = NOW() 
WHERE email = 'carissa.imrecke@wellspharma.com' AND day_14_notified_at IS NULL;