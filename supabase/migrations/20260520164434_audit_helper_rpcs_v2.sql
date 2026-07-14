
DROP FUNCTION IF EXISTS audit_recent_function_failures(int);
DROP FUNCTION IF EXISTS audit_recent_cron_failures(int);

CREATE FUNCTION audit_recent_function_failures(p_hours int)
RETURNS TABLE(response_id bigint, created_at timestamptz, status_code int, error_msg text, body_preview text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = net, public
AS $$
  SELECT 
    id AS response_id,
    created AS created_at,
    status_code,
    error_msg,
    LEFT(content::text, 300) AS body_preview
  FROM net._http_response
  WHERE created > now() - (p_hours || ' hours')::interval
    AND (status_code IS NULL OR status_code NOT BETWEEN 200 AND 299)
  ORDER BY created DESC
  LIMIT 50;
$$;

CREATE FUNCTION audit_recent_cron_failures(p_hours int)
RETURNS TABLE(jobid bigint, jobname text, start_time timestamptz, status text, return_message text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT 
    j.jobid,
    j.jobname,
    d.start_time,
    d.status,
    LEFT(COALESCE(d.return_message, ''), 300)
  FROM cron.job j
  JOIN cron.job_run_details d ON d.jobid = j.jobid
  WHERE d.start_time > now() - (p_hours || ' hours')::interval
    AND d.status != 'succeeded'
  ORDER BY d.start_time DESC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION audit_recent_function_failures(int) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION audit_recent_cron_failures(int) TO service_role, authenticated;
