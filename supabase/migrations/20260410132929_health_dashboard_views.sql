
-- 1. Entitlement gaps — buyers locked out
CREATE OR REPLACE VIEW public.audit_entitlement_gaps AS
SELECT
  p.email,
  p.purchased_at AS purchase_date,
  p.case_file_id AS product,
  p.stripe_session_id,
  'MISSING_ENTITLEMENT' AS status
FROM public.purchases p
LEFT JOIN public.entitlements e ON p.email = e.email
WHERE e.email IS NULL;

-- 2. Identity stitch health — leads linked to behavior
CREATE OR REPLACE VIEW public.audit_identity_health AS
SELECT
  c.email,
  c.created_at            AS lead_created_at,
  c.cw_user_id IS NOT NULL AS is_stitched,
  c.attio_person_id IS NOT NULL AS in_attio,
  c.lifecycle_stage,
  COUNT(ev.id)            AS total_behavioral_events
FROM public.contacts c
LEFT JOIN public.events ev
  ON c.cw_user_id = ev.session_id
GROUP BY c.email, c.created_at, c.cw_user_id, c.attio_person_id, c.lifecycle_stage;

-- 3. System velocity — queue and dispatcher health
CREATE OR REPLACE VIEW public.audit_system_velocity AS
SELECT 'Outreach Queue Pending'    AS metric, COUNT(*) AS count, MAX(queued_at) AS last_record_at FROM public.outreach_queue  WHERE status = 'pending'
UNION ALL
SELECT 'Purchases Without Email'   AS metric, COUNT(*) AS count, NULL            FROM public.purchases          WHERE email = 'unknown' OR email IS NULL
UNION ALL
SELECT 'Contacts Without Attio ID' AS metric, COUNT(*) AS count, NULL            FROM public.contacts           WHERE attio_person_id IS NULL
UNION ALL
SELECT 'Entitlement Gaps'          AS metric, COUNT(*) AS count, NULL            FROM public.audit_entitlement_gaps
UNION ALL
SELECT 'Unstitched Leads'          AS metric, COUNT(*) AS count, NULL            FROM public.audit_identity_health WHERE is_stitched = false;
