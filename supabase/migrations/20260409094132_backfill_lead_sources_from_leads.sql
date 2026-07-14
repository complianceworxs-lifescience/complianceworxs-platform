
-- Step 4: Populate lead_sources from UTM data in leads
INSERT INTO lead_sources (
  contact_id,
  source,
  medium,
  campaign,
  referrer,
  landing_page,
  first_touch,
  captured_at
)
SELECT
  c.id AS contact_id,
  l.utm_source  AS source,
  l.utm_medium  AS medium,
  l.utm_campaign AS campaign,
  NULL           AS referrer,
  l.page         AS landing_page,
  TRUE           AS first_touch,
  l.created_at   AS captured_at
FROM contacts c
JOIN leads l ON lower(trim(c.email)) = lower(trim(l.email))
WHERE l.utm_source IS NOT NULL
ON CONFLICT DO NOTHING;
