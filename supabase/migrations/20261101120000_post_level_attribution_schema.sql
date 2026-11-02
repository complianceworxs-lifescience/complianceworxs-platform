-- Post-level LinkedIn attribution: schema, UTM generator/validator, "no number without a join method" guard.
-- Additive only. Standard: utm_source=linkedin, utm_medium=organic_social, utm_campaign=<slug-YYYYMMDD>, utm_content=<buffer_post_id>.

alter table public.cw_content_performance
  add column if not exists utm_content text,
  add column if not exists posthog_sample_views integer,
  add column if not exists posthog_checkout_starts integer,
  add column if not exists posthog_purchases integer,
  add column if not exists posthog_event_breakdown jsonb,
  add column if not exists posthog_joined_at timestamptz;

comment on column public.cw_content_performance.utm_content is 'Buffer post id carried in the tagged link; with utm_campaign it is the exact PostHog join key.';
comment on column public.cw_content_performance.clicks is 'When posthog_join_method = exact_utm_campaign_content: qualified PostHog landing sessions (bots, staff and test traffic excluded). NULL = untracked.';
comment on column public.cw_content_performance.posthog_qualified_events is 'sample views + checkout starts + purchases, session/journey-matched to this post. NULL = untracked.';

create unique index if not exists cw_content_performance_utm_key_uidx
  on public.cw_content_performance (utm_campaign, utm_content)
  where utm_campaign is not null and utm_content is not null and utm_content ~ '^[a-f0-9]{24}$';

create or replace function public.cw_linkedin_content_key(p_slug text, p_date date)
returns text language plpgsql immutable as $$
declare s text := trim(both '-' from regexp_replace(lower(coalesce(p_slug,'')), '[^a-z0-9]+', '-', 'g'));
begin
  if s = '' or p_date is null then raise exception 'content_key needs a non-empty slug and a date'; end if;
  return s || '-' || to_char(p_date, 'YYYYMMDD');
end $$;

create or replace function public.cw_validate_linkedin_utm_url(p_url text)
returns jsonb language plpgsql immutable as $$
declare
  errs text[] := '{}'; host text; q text; kv text[]; pair text; k text; v text;
  src text[] := '{}'; med text[] := '{}'; camp text[] := '{}'; cont text[] := '{}'; extra text[] := '{}'; d date;
begin
  if p_url is null or p_url !~ '^https?://[^/?#]+' then return jsonb_build_object('ok', false, 'errors', jsonb_build_array('not a valid absolute URL')); end if;
  if p_url !~ '^https://' then errs := array_append(errs, 'must be https'::text); end if;
  host := lower(substring(p_url from '^https?://([^/?#:]+)'));
  if host ~ '(^|\.)buff\.ly$' then errs := array_append(errs, 'short links (buff.ly) are not allowed'::text);
  elsif host not in ('www.complianceworxs.com','complianceworxs.com','cases.complianceworxs.com') then errs := array_append(errs, ('host not allowed: ' || host)::text); end if;
  q := split_part(split_part(p_url, '#', 1), '?', 2);
  foreach pair in array string_to_array(q, '&') loop
    continue when pair = '';
    k := split_part(pair, '=', 1); v := substr(pair, length(k) + 2);
    if k = 'utm_source' then src := src || v; elsif k = 'utm_medium' then med := med || v;
    elsif k = 'utm_campaign' then camp := camp || v; elsif k = 'utm_content' then cont := cont || v;
    elsif lower(k) like 'utm\_%' then extra := extra || k; end if;
  end loop;
  if cardinality(src)=0 then errs := array_append(errs, 'missing utm_source'::text); elsif cardinality(src)>1 then errs := array_append(errs, 'duplicate utm_source'::text); elsif src[1] <> 'linkedin' then errs := array_append(errs, 'utm_source must be linkedin'::text); end if;
  if cardinality(med)=0 then errs := array_append(errs, 'missing utm_medium'::text); elsif cardinality(med)>1 then errs := array_append(errs, 'duplicate utm_medium'::text); elsif med[1] <> 'organic_social' then errs := array_append(errs, 'utm_medium must be organic_social'::text); end if;
  if cardinality(camp)=0 then errs := array_append(errs, 'missing utm_campaign'::text); elsif cardinality(camp)>1 then errs := array_append(errs, 'duplicate utm_campaign'::text);
  elsif camp[1] !~ '^[a-z0-9]+(-[a-z0-9]+)*-\d{8}$' then errs := array_append(errs, 'utm_campaign must be slug-YYYYMMDD'::text);
  else
    begin d := to_date(right(camp[1], 8), 'YYYYMMDD'); if to_char(d,'YYYYMMDD') <> right(camp[1], 8) then errs := array_append(errs, 'utm_campaign date is not a real date'::text); end if;
    exception when others then errs := array_append(errs, 'utm_campaign date is not a real date'::text); end;
  end if;
  if cardinality(cont)=0 then errs := array_append(errs, 'missing utm_content'::text); elsif cardinality(cont)>1 then errs := array_append(errs, 'duplicate utm_content'::text); elsif cont[1] !~ '^[a-f0-9]{24}$' then errs := array_append(errs, 'utm_content must be a 24-char hex buffer_post_id'::text); end if;
  if cardinality(extra)>0 then errs := array_append(errs, 'unexpected utm params'::text); end if;
  return jsonb_build_object('ok', cardinality(errs)=0, 'errors', to_jsonb(errs));
end $$;

create or replace function public.cw_build_linkedin_utm_url(p_base_url text, p_content_key text, p_buffer_post_id text)
returns text language plpgsql immutable as $$
declare base text; q text; kept text := ''; pair text; out text; res jsonb;
begin
  base := split_part(split_part(p_base_url, '#', 1), '?', 1);
  q := split_part(split_part(p_base_url, '#', 1), '?', 2);
  foreach pair in array string_to_array(q, '&') loop
    continue when pair = '' or lower(pair) like 'utm\_%';
    kept := kept || pair || '&';
  end loop;
  out := base || '?' || kept || 'utm_source=linkedin&utm_medium=organic_social&utm_campaign=' || p_content_key || '&utm_content=' || p_buffer_post_id;
  res := public.cw_validate_linkedin_utm_url(out);
  if not (res->>'ok')::boolean then raise exception 'invalid LinkedIn UTM url: %', res->'errors'; end if;
  return out;
end $$;

-- Creation-time helper: stores the tagged URL, campaign and content on the row (validated).
create or replace function public.cw_tag_content_row(p_row_id uuid, p_base_url text, p_slug text, p_buffer_post_id text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.cw_content_performance; key text; url text;
begin
  select * into r from public.cw_content_performance where id = p_row_id for update;
  if not found then raise exception 'row % not found', p_row_id; end if;
  key := public.cw_linkedin_content_key(p_slug, (r.published_at at time zone 'UTC')::date);
  url := public.cw_build_linkedin_utm_url(p_base_url, key, p_buffer_post_id);
  update public.cw_content_performance set canonical_url = url, utm_campaign = key, utm_content = p_buffer_post_id,
    buffer_post_id = coalesce(buffer_post_id, p_buffer_post_id) where id = p_row_id;
  return url;
end $$;
revoke all on function public.cw_tag_content_row(uuid,text,text,text) from public, anon, authenticated;

-- Guard: a PostHog-derived number may never be written without a join method; join method must be known; tags must validate.
create or replace function public.cw_content_performance_attribution_guard()
returns trigger language plpgsql as $$
begin
  if (new.posthog_qualified_events is not null or new.posthog_sample_views is not null
      or new.posthog_checkout_starts is not null or new.posthog_purchases is not null)
     and new.posthog_join_method is null then
    raise exception 'cw_content_performance: PostHog numbers require posthog_join_method (row %)', new.id;
  end if;
  if new.posthog_join_method = 'exact_utm_campaign_content'
     and (new.utm_campaign is null or new.utm_content is null) then
    raise exception 'cw_content_performance: exact_utm_campaign_content requires utm_campaign and utm_content (row %)', new.id;
  end if;
  if new.utm_content is not null and new.canonical_url is not null and new.canonical_url like '%utm_%'
     and not (public.cw_validate_linkedin_utm_url(new.canonical_url)->>'ok')::boolean then
    raise exception 'cw_content_performance: canonical_url fails LinkedIn UTM standard (row %)', new.id;
  end if;
  return new;
end $$;

drop trigger if exists cw_content_performance_attribution_guard_trg on public.cw_content_performance;
create trigger cw_content_performance_attribution_guard_trg
  before insert or update on public.cw_content_performance
  for each row execute function public.cw_content_performance_attribution_guard();
