-- Backfill. No guessing, no day-level inference.
-- (1) Past link-bearing posts without the standard tags: insufficient_evidence + reason, numbers stay NULL.
-- (2) Posts with no link: insufficient_evidence + reason (cannot reach the site).
-- (3) Tag the scheduled rows whose Buffer posts were edited on 2026-11-01 (utm_content = buffer_post_id).
-- The prepublication/attribution triggers still run. Clearing posthog_join_method on the 142 default rows is a no-op.

update public.cw_content_performance
set posthog_join_confidence = 'insufficient_evidence',
    posthog_join_method = null,
    posthog_join_notes = case
      when post_text ilike '%utm_%' then 'insufficient_evidence: link carries legacy/non-standard UTMs (no post-unique utm_content); exact post-level join impossible. No day-level inference applied.'
      else 'insufficient_evidence: link-bearing post published without UTMs; no exact post-level join possible. No day-level inference applied.' end
where channel = 'jmnugent' and post_text ~* 'https?://'
  and utm_content is null and posthog_qualified_events is null and clicks is null;

update public.cw_content_performance
set posthog_join_notes = 'insufficient_evidence: no link in post_text; post cannot drive tracked site visits.'
where channel = 'jmnugent' and (post_text is null or post_text !~* 'https?://') and posthog_join_notes is null
  and posthog_qualified_events is null and clicks is null;

-- (3) scheduled rows matching the edited Buffer posts. content_key date = Buffer dueAt (UTC) date.
with t(buffer_post_id, path, slug, due) as (values
  ('6aabdb24b9afe5545d37461e','/sample','proof-reviewer-ready','2026-11-04'),
  ('6aabdb38a7c75ebb89f3eff0','/pharma/irr-record','offer-one-decision','2026-11-04'),
  ('6aabdb5fb9afe5545d374f0f','/sample','proof-capa-reviewer','2026-11-10'),
  ('6aabdb88b9afe5545d375153','/pharma/irr-record','offer-capa-decision','2026-11-11'),
  ('6aabdbcc7bafaeaeade53251','/sample','proof-summary-vs-record','2026-11-17'),
  ('6aabdbd27bafaeaeade532f7','/pharma/irr-record','offer-deviation-decision','2026-11-17'),
  ('6aabdbe93c5011c0df7a360c','/irr','proof-boundaries','2026-11-19'),
  ('6aabdbefa7c75ebb89f400e1','/pharma/irr-record','offer-decision-context','2026-11-24'))
update public.cw_content_performance c
set utm_campaign = public.cw_linkedin_content_key(t.slug, t.due::date),
    utm_content = t.buffer_post_id,
    canonical_url = public.cw_build_linkedin_utm_url('https://www.complianceworxs.com' || t.path, public.cw_linkedin_content_key(t.slug, t.due::date), t.buffer_post_id),
    posthog_join_notes = 'tagged 2026-11-01; awaiting publication and first daily join'
from t where c.buffer_post_id = t.buffer_post_id and c.governed_state = 'scheduled' and c.utm_content is null;
