-- Re-creates cw_validate_linkedin_utm_url with array_append (text[] || unknown-literal is ambiguous in Postgres).
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

