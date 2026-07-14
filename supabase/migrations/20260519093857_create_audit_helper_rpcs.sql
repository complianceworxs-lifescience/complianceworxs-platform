-- RPC: pull recent non-200 edge function responses for outbound-related calls
CREATE OR REPLACE FUNCTION public.audit_recent_function_failures(p_hours int DEFAULT 24)
RETURNS TABLE (
  request_id bigint,
  created timestamptz,
  status_code int,
  url text,
  content_preview text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id::bigint,
    r.created,
    r.status_code,
    COALESCE(r.headers->>'url', '')::text AS url,
    LEFT(r.content::text, 300) AS content_preview
  FROM net._http_response r
  WHERE r.created > now() - (p_hours || ' hours')::interval
    AND r.status_code IS NOT NULL
    AND r.status_code >= 400
  ORDER BY r.created DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_recent_function_failures(int) TO service_role;