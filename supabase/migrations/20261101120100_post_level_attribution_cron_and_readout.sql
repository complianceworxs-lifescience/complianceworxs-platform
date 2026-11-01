-- Daily join job (existing pattern: pg_cron -> net.http_post -> edge function, x-cron-secret from cw_secrets).
-- 09:25 UTC, after posthog-conversion-monitor (09:15).
do $$ begin
  perform cron.unschedule('cw-post-attribution-join-daily') where exists (select 1 from cron.job where jobname = 'cw-post-attribution-join-daily');
exception when others then null; end $$;

select cron.schedule('cw-post-attribution-join-daily', '25 9 * * *', $cron$
  select net.http_post(
    url := 'https://balkvbmtummehgbbeqap.supabase.co/functions/v1/cw-post-attribution-join',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.cw_secrets where name = 'wf-cron-secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
$cron$);

-- Per-post readout. Real numbers only: controlled-test and synthetic rows are excluded.
create or replace view public.cw_linkedin_post_attribution_readout as
select id, buffer_post_id, published_at, topic, cta_stage, utm_campaign, utm_content, canonical_url,
       clicks, posthog_sample_views as sample_views, posthog_checkout_starts as checkout_starts, posthog_purchases as purchases,
       posthog_qualified_events as qualified_events, posthog_join_method as join_method, posthog_join_confidence as join_confidence,
       posthog_join_notes as join_notes, posthog_joined_at as joined_at,
       (posthog_event_breakdown #>> '{excluded_landing_sessions}')::jsonb as excluded_landing_sessions
from public.cw_content_performance
where (channel_service = 'linkedin' or channel in ('jon_nugent_linkedin','jmnugent'))
  and is_controlled_test = false and is_synthetic = false;
