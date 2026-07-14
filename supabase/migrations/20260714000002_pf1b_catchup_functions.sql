-- PF-1B CATCH-UP MIGRATION (out-of-band recovery)
-- These objects existed in production (project balkvbmtummehgbbeqap) but were
-- created outside the migration history (SQL editor/dashboard). Captured here from
-- their live definitions so the migration set fully reproduces production.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE): safe to re-apply.

CREATE OR REPLACE FUNCTION public.check_auth_status()
 RETURNS text
 LANGUAGE plpgsql
AS $function$ 
BEGIN 
  RETURN 'Database is Writeable'; 
END; 
$function$
;

CREATE OR REPLACE FUNCTION public.detect_strategy_signals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  signal_count int := 0;
  v_visitors_7d int; v_visitors_prev_7d int; v_visitors_change_pct numeric;
  v_captures_7d int; v_captures_prev_7d int; v_captures_change_pct numeric;
  v_touches_7d int; v_revenue_pace numeric; v_days_remaining int;
  v_paid_clicks_7d numeric; v_paid_clicks_prev_7d numeric;
  v_daily_intake int; v_dms_today int; v_hour_et int;
  rec RECORD;
BEGIN
  PERFORM refresh_key_results();
  
  -- Visitor trend
  SELECT count(DISTINCT session_id) INTO v_visitors_7d FROM events WHERE event_name = 'page_view' AND created_at >= now() - interval '7 days' AND session_id IS NOT NULL;
  SELECT count(DISTINCT session_id) INTO v_visitors_prev_7d FROM events WHERE event_name = 'page_view' AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days' AND session_id IS NOT NULL;
  IF v_visitors_prev_7d > 0 THEN
    v_visitors_change_pct := ROUND(((v_visitors_7d - v_visitors_prev_7d)::numeric / v_visitors_prev_7d * 100), 0);
    IF v_visitors_change_pct <= -25 THEN
      INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) VALUES ('visitor_drop', 'critical',
        'Weekly visitors dropped ' || v_visitors_change_pct || '% (' || v_visitors_prev_7d || ' → ' || v_visitors_7d || ')',
        'Pipeline depends on visitor flow.', 'Check LinkedIn group post status. Concentrate distribution on Batch Release.')
      ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
      IF FOUND THEN signal_count := signal_count + 1; END IF;
    END IF;
  END IF;

  -- NEW: Phantombuster daily intake check
  SELECT count(*)::int INTO v_daily_intake FROM contacts 
  WHERE created_at >= CURRENT_DATE 
    AND email NOT LIKE '%@complianceworxs.com' 
    AND email NOT LIKE '%@coursworx.com';
  
  -- Only fire after 6 PM ET (22 UTC) to avoid morning false alarms
  v_hour_et := EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/New_York'))::int;
  IF v_hour_et >= 18 AND v_daily_intake < 25 THEN
    INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) 
    VALUES ('phantombuster_intake_low', 'critical',
      'Phantombuster intake at ' || v_daily_intake || ' today (target 50/day, threshold 25)',
      'Daily new-contact intake from the Phantombuster pipeline (Sales Navigator Search Export, Profile Scraper, Group Members Export) is below half-target. The 12,000-prospect Sales Navigator search should be feeding 50/day at minimum.',
      'Check Phantombuster: verify all phantoms are ON, have remaining daily slots, and the Sales Navigator session cookie has not expired. Also check that incoming profiles are being written to the contacts table by the enrichment flow.')
    ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN signal_count := signal_count + 1; END IF;
  END IF;

  -- NEW: Daily DM pace check
  SELECT count(*)::int INTO v_dms_today FROM outreach_touches 
  WHERE source_type='outbound' AND sent_at >= CURRENT_DATE;
  
  -- Only fire after 2 PM ET (18 UTC), warning if behind 10 by mid-afternoon
  IF v_hour_et >= 14 AND v_dms_today < 10 THEN
    INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) 
    VALUES ('daily_dm_pace_low', 'warning',
      'Only ' || v_dms_today || ' DMs sent today by ' || v_hour_et || ':00 ET (target 20/day)',
      'Past mid-afternoon with fewer than 10 outbound touches today. Pace puts the daily 20-DM target at risk.',
      'Pull next batch from outreach_queue: SELECT email_subject, email_body FROM outreach_queue WHERE trigger_reason LIKE ''staged_dm_v%'' AND status = ''pending'' LIMIT 10;')
    ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN signal_count := signal_count + 1; END IF;
  END IF;

  -- Capture rate from PostHog cache
  SELECT metric_value::int INTO v_captures_7d FROM posthog_metric_cache WHERE metric_key = 'captures_7d';
  IF v_visitors_7d > 50 AND v_captures_7d = 0 THEN
    INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) VALUES ('zero_captures', 'critical',
      'Zero captures from ' || v_visitors_7d || ' visitors in last 7 days',
      'Form gate not converting.', 'Test the form yourself.')
    ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN signal_count := signal_count + 1; END IF;
  END IF;

  -- Outbound pace (weekly)
  SELECT count(*) INTO v_touches_7d FROM outreach_touches WHERE source_type = 'outbound' AND sent_at >= now() - interval '7 days';
  IF v_touches_7d < 50 AND EXTRACT(DOW FROM CURRENT_DATE) >= 4 THEN  -- raised threshold from 15 to 50
    INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) VALUES ('outbound_slipping', 'warning',
      'Only ' || v_touches_7d || ' outbound touches this week (target 100/wk = 20/day x 5)',
      'New target: 20 DMs/day x 5 working days = 100/week. Pipeline can''t close what wasn''t opened.',
      'Pull and send next batch from outreach_queue. Phantombuster intake should be feeding fresh prospects daily.')
    ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN signal_count := signal_count + 1; END IF;
  END IF;

  -- Revenue pace
  v_days_remaining := GREATEST(0, EXTRACT(EPOCH FROM ('2026-06-01'::timestamp - now())) / 86400)::int;
  SELECT GREATEST(0, (1500 - coalesce(sum(amount_cents),0)/100.0)) / GREATEST(1, v_days_remaining) INTO v_revenue_pace
    FROM orders WHERE order_status='completed' AND refunded_at IS NULL AND purchased_at >= '2026-05-01' AND purchased_at < '2026-06-01';
  IF v_revenue_pace > 100 THEN
    INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) VALUES ('revenue_pace_high', 'warning',
      'Required daily revenue pace: $' || ROUND(v_revenue_pace, 0)::text || '/day (' || v_days_remaining || ' days remaining)',
      'May target requires escalating effort.', 'Close one $149-$297 sale this week, or revise May target.')
    ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN signal_count := signal_count + 1; END IF;
  END IF;

  -- Unworked leads (existing)
  FOR rec IN
    SELECT c.id, c.email, c.first_name, c.company, c.job_title, c.created_at FROM contacts c
    WHERE c.lifecycle_stage = 'lead' AND c.created_at < now() - interval '5 days'
      AND c.email NOT LIKE '%@complianceworxs.com' AND c.email NOT LIKE '%@coursworx.com'
      AND NOT EXISTS (SELECT 1 FROM outreach_touches ot WHERE ot.target_email = c.email AND ot.sent_at >= c.created_at)
    ORDER BY c.created_at DESC LIMIT 20
  LOOP
    INSERT INTO strategy_signals (signal_type, severity, title, detail, suggested_action) VALUES ('unworked_lead', 'warning',
      'Unworked lead: ' || coalesce(rec.first_name, '') || ' ' || coalesce(rec.job_title, '') || ' at ' || coalesce(rec.company, '(unknown)') || ' — ' || rec.email,
      'Captured ' || ROUND(EXTRACT(EPOCH FROM (now() - rec.created_at))/86400) || ' days ago, no follow-up sent.',
      'DM or email this person.')
    ON CONFLICT (signal_type, title) WHERE resolved_at IS NULL DO NOTHING;
    IF FOUND THEN signal_count := signal_count + 1; END IF;
  END LOOP;

  RETURN signal_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dm_send_eligibility(p_outreach_queue_id uuid)
 RETURNS TABLE(eligible boolean, reason text, q_email text, q_first_name text, q_last_name text, q_company text, q_job_title text, q_linkedin_url text, q_email_subject text, q_email_body text, q_case_file text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  q RECORD;
  c RECORD;
  v_domain text;
  v_company_lower text;
  v_title_lower text;
  v_passes_audience boolean := false;
  v_passes_title_block boolean := true;
  v_recent_touch_count int;
  v_paid_count int;
  v_replied_count int;
BEGIN
  -- Pull the queue row
  SELECT * INTO q FROM outreach_queue WHERE id = p_outreach_queue_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'queue_row_not_found', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Pull the contact
  SELECT * INTO c FROM contacts WHERE normalized_email = lower(q.email);
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'contact_not_found', q.email, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  -- FILTER 1: Identity completeness
  IF c.first_name IS NULL OR length(trim(c.first_name)) < 2 THEN
    RETURN QUERY SELECT false, 'no_first_name', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;
  IF c.linkedin_url IS NULL OR c.linkedin_url = '' THEN
    RETURN QUERY SELECT false, 'no_linkedin_url', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;
  IF c.company IS NULL OR length(trim(c.company)) < 2 THEN
    RETURN QUERY SELECT false, 'no_company', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  v_domain := lower(split_part(q.email, '@', 2));
  v_company_lower := lower(coalesce(c.company, ''));
  v_title_lower := lower(coalesce(c.job_title, ''));

  -- FILTER 2a: Domain blocklist (always reject)
  IF EXISTS (SELECT 1 FROM dm_audience_signals WHERE signal_type = 'domain_block' AND lower(value) = v_domain) THEN
    RETURN QUERY SELECT false, 'blocked_personal_domain:' || v_domain, q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  -- FILTER 2b: Title blocklist (always reject if title contains blocked term)
  IF v_title_lower != '' THEN
    IF EXISTS (SELECT 1 FROM dm_audience_signals WHERE signal_type = 'title_block' AND v_title_lower LIKE '%' || lower(value) || '%') THEN
      RETURN QUERY SELECT false, 'blocked_title:' || v_title_lower, q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
      RETURN;
    END IF;
  END IF;

  -- FILTER 2c: Audience fit — pass if any of these is true:
  --   (a) Email domain on pharma allowlist
  --   (b) Company name contains a pharma keyword
  --   (c) Domain contains a pharma keyword
  --   (d) Job title contains an allowed compliance signal
  IF EXISTS (SELECT 1 FROM dm_audience_signals WHERE signal_type = 'pharma_domain' AND lower(value) = v_domain) THEN
    v_passes_audience := true;
  ELSIF EXISTS (SELECT 1 FROM dm_audience_signals WHERE signal_type = 'pharma_keyword' AND v_company_lower LIKE '%' || lower(value) || '%') THEN
    v_passes_audience := true;
  ELSIF EXISTS (SELECT 1 FROM dm_audience_signals WHERE signal_type = 'pharma_keyword' AND v_domain LIKE '%' || lower(value) || '%') THEN
    v_passes_audience := true;
  ELSIF v_title_lower != '' AND EXISTS (SELECT 1 FROM dm_audience_signals WHERE signal_type = 'title_allow' AND v_title_lower LIKE '%' || lower(value) || '%') THEN
    v_passes_audience := true;
  END IF;

  IF NOT v_passes_audience THEN
    RETURN QUERY SELECT false, 'audience_review_required', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  -- FILTER 3a: Cooldown — no DM/email touch in last N hours
  SELECT count(*) INTO v_recent_touch_count
  FROM outreach_touches
  WHERE target_email = q.email
    AND sent_at >= now() - ((SELECT cooldown_hours FROM dm_automation_config WHERE id=1)::text || ' hours')::interval
    AND channel IN ('linkedin_dm', 'email');
  IF v_recent_touch_count > 0 THEN
    RETURN QUERY SELECT false, 'cooldown_active:' || v_recent_touch_count || '_recent_touches', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  -- FILTER 3b: Already paying customer
  SELECT count(*) INTO v_paid_count FROM orders 
  WHERE contact_id = c.id AND order_status = 'completed' AND refunded_at IS NULL;
  IF v_paid_count > 0 THEN
    RETURN QUERY SELECT false, 'is_paying_customer', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  -- FILTER 3c: Already replied to a previous touch
  SELECT count(*) INTO v_replied_count FROM outreach_touches
  WHERE target_email = q.email AND reply_received = true;
  IF v_replied_count > 0 THEN
    RETURN QUERY SELECT false, 'already_replied', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
    RETURN;
  END IF;

  -- ALL FILTERS PASSED
  RETURN QUERY SELECT true, 'eligible', q.email, c.first_name, c.last_name, c.company, c.job_title, c.linkedin_url, q.email_subject, q.email_body, q.case_file;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.exec_optimization_query(sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
BEGIN
  -- Block obvious mutations
  IF sql ~* '\m(insert|update|delete|drop|truncate|alter|create|grant|revoke)\M' THEN
    RAISE EXCEPTION 'Mutation queries not allowed in exec_optimization_query';
  END IF;
  
  EXECUTE 'SELECT to_jsonb(coalesce(jsonb_agg(t), ''[]''::jsonb)) FROM (' || sql || ') t' INTO result;
  RETURN result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_posthog_purchase_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- Only fire on completed, non-refunded orders
  IF NEW.order_status = 'completed' AND NEW.refunded_at IS NULL THEN
    PERFORM net.http_post(
      url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/posthog-purchase-event',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('order_id', NEW.id),
      timeout_milliseconds := 10000
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_partner_code(applicant_name text, applicant_company text)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  base_source TEXT;
  base_code   TEXT;
  candidate   TEXT;
  suffix      INT := 0;
BEGIN
  base_source := COALESCE(NULLIF(TRIM(applicant_company), ''), applicant_name);
  base_code := UPPER(REGEXP_REPLACE(base_source, '[^A-Za-z0-9]', '', 'g'));
  base_code := SUBSTRING(base_code FROM 1 FOR 8);

  IF base_code = '' OR base_code IS NULL THEN
    base_code := 'PARTNER';
  END IF;

  candidate := base_code;
  WHILE EXISTS (SELECT 1 FROM partners WHERE partner_code = candidate) LOOP
    suffix := suffix + 1;
    candidate := base_code || suffix::TEXT;
  END LOOP;

  RETURN candidate;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_operating_dashboard()
 RETURNS TABLE(section text, item text, detail text, item_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM refresh_key_results();
  
  RETURN QUERY
  SELECT '1_OBJECTIVE'::text, o.name::text, 
    o.period_start::text || ' to ' || o.period_end::text, 
    o.status::text
  FROM objectives o WHERE o.status = 'active' ORDER BY o.id;
  
  RETURN QUERY
  SELECT '2_KEY_RESULTS'::text, k.name::text,
    'current: ' || k.current_value::text || ' / target: ' || k.target_value::text || ' (' ||
    COALESCE(ROUND((k.current_value / NULLIF(k.target_value, 0) * 100)::numeric, 0)::text, '0') || '%)',
    CASE 
      WHEN k.current_value >= k.target_value THEN 'achieved'
      WHEN k.current_value >= k.target_value * 0.7 THEN 'on_track'
      WHEN k.current_value >= k.target_value * 0.3 THEN 'behind'
      ELSE 'critical'
    END::text
  FROM key_results k 
  INNER JOIN objectives o ON o.id = k.objective_id 
  WHERE o.status = 'active' ORDER BY k.id;
  
  RETURN QUERY
  SELECT '3_INITIATIVES'::text, 
    'L' || i.filter_layer::text || ': ' || i.name::text,
    COALESCE(i.measure_of_success, 'no measure defined')::text,
    i.status::text
  FROM initiatives i
  WHERE i.status IN ('active', 'planned') 
  ORDER BY i.filter_layer, i.id;
  
  RETURN QUERY
  SELECT '4_THIS_WEEK'::text, t.task::text,
    COALESCE((SELECT i2.name FROM initiatives i2 WHERE i2.id = t.initiative_id), 'unattached')::text,
    t.status::text
  FROM weekly_tasks t
  WHERE t.week_of = DATE_TRUNC('week', CURRENT_DATE)
  ORDER BY t.initiative_id NULLS LAST, t.id;
  
  RETURN QUERY
  SELECT '5_LEGACY_COMMITMENTS'::text, oc.commitment::text, oc.week_of::text, oc.status::text
  FROM operator_commitments oc
  WHERE oc.status = 'open' AND oc.week_of >= CURRENT_DATE - interval '14 days'
  ORDER BY oc.week_of DESC, oc.id DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_revenue_status()
 RETURNS TABLE(metric text, value text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  WITH r AS (SELECT * FROM v_may2026_revenue)
  SELECT 'May 2026 revenue', '$' || to_char((SELECT may_revenue_usd FROM r), 'FM999,990.00') FROM r
  UNION ALL SELECT 'May 2026 target', '$1,500.00' FROM r
  UNION ALL SELECT 'Pct to target', to_char((SELECT pct_to_target FROM r) * 100, 'FM990.0') || '%' FROM r
  UNION ALL SELECT 'May orders', (SELECT may_orders::text FROM r) FROM r
  UNION ALL SELECT 'Days remaining to May 31', (SELECT days_remaining_to_may31::text FROM r) FROM r
  UNION ALL SELECT 'Required daily run rate', '$' || to_char((SELECT required_daily_run_rate_usd FROM r), 'FM999,990.00') FROM r
  UNION ALL SELECT 'Last 7 days revenue', '$' || to_char((SELECT last_7d_revenue_usd FROM r), 'FM999,990.00') FROM r
  UNION ALL SELECT 'Last 30 days revenue', '$' || to_char((SELECT last_30d_revenue_usd FROM r), 'FM999,990.00') FROM r
  UNION ALL SELECT 'Lifetime revenue', '$' || to_char((SELECT lifetime_revenue_usd FROM r), 'FM999,990.00') FROM r
  UNION ALL SELECT 'Lifetime orders', (SELECT lifetime_orders::text FROM r) FROM r;
$function$
;

CREATE OR REPLACE FUNCTION public.on_partner_application_approved()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_code TEXT;
  service_key TEXT;
BEGIN
  -- Only run when status transitions to 'approved'
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN

    -- If a code was already assigned (manual override), use it; else generate
    IF NEW.partner_code IS NULL OR NEW.partner_code = '' THEN
      new_code := generate_partner_code(NEW.full_name, NEW.company);
      NEW.partner_code := new_code;
    ELSE
      new_code := NEW.partner_code;
    END IF;

    -- Stamp approval timestamp
    NEW.approved_at := COALESCE(NEW.approved_at, NOW());

    -- Create the active partner row (idempotent)
    INSERT INTO partners (partner_code, partner_name, contact_email, status)
    VALUES (
      new_code,
      COALESCE(NULLIF(TRIM(NEW.company), ''), NEW.full_name),
      NEW.email,
      'active'
    )
    ON CONFLICT (contact_email) DO UPDATE
      SET status = 'active',
          partner_code = EXCLUDED.partner_code;

    -- Fire welcome email via pg_net (async)
    BEGIN
      service_key := current_setting('app.service_role_key', true);
    EXCEPTION WHEN OTHERS THEN
      service_key := NULL;
    END;

    IF service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/partner-welcome',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object(
          'email', NEW.email,
          'full_name', NEW.full_name,
          'company', NEW.company,
          'partner_code', new_code
        )
      );

      NEW.welcome_email_sent_at := NOW();
    END IF;

  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_cohort_leads_from_disqualification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.enrichment_status = 'disqualified_junk_company'
     AND NEW.cohort_label IN (
       'QA_LEADERSHIP', 'QA_OPERATIONS', 'QUALITY_SYSTEMS', 'QUALITY_CONTROL',
       'REGULATORY_AFFAIRS', 'GMP_COMPLIANCE', 'CSV_VALIDATION',
       'VALIDATION_GENERIC', 'AUDIT'
     ) THEN
    RAISE EXCEPTION 'Cannot mark cohort-tagged ICP lead (%) as disqualified_junk_company. Lead %, cohort %.',
      NEW.full_name, NEW.id, NEW.cohort_label;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_key_results()
 RETURNS TABLE(kr_name text, target numeric, current numeric, pct_to_target numeric, kr_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  kr RECORD;
  result_value numeric;
BEGIN
  FOR kr IN SELECT * FROM key_results WHERE metric_query IS NOT NULL LOOP
    BEGIN
      EXECUTE kr.metric_query INTO result_value;
      UPDATE key_results SET current_value = COALESCE(result_value, 0), last_measured_at = now() WHERE id = kr.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE key_results SET last_measured_at = now() WHERE id = kr.id;
    END;
  END LOOP;
  
  RETURN QUERY
    SELECT 
      k.name,
      k.target_value,
      k.current_value,
      ROUND((k.current_value / NULLIF(k.target_value, 0) * 100)::numeric, 1) AS pct_to_target,
      CASE 
        WHEN k.current_value >= k.target_value THEN 'achieved'
        WHEN k.current_value >= k.target_value * 0.7 THEN 'on_track'
        WHEN k.current_value >= k.target_value * 0.3 THEN 'behind'
        ELSE 'critical'
      END AS kr_status
    FROM key_results k
    INNER JOIN objectives o ON o.id = k.objective_id
    WHERE o.status = 'active'
    ORDER BY k.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

