-- View: redirects waiting to be actioned (manually researched and added back to warm_outbound_staging)
CREATE OR REPLACE VIEW pending_redirects AS
SELECT 
  d.id,
  d.original_full_name,
  d.original_company,
  d.redirect_name,
  d.redirect_email,
  d.detected_at,
  d.note,
  EXTRACT(epoch FROM (NOW() - d.detected_at))/86400 AS days_pending
FROM departed_employee_redirects d
WHERE d.actioned_at IS NULL
  AND (d.redirect_name IS NOT NULL OR d.redirect_email IS NOT NULL)
ORDER BY d.detected_at DESC;