-- Classification of jmnugent LinkedIn rows from post_text. Fixed taxonomy. Reversible (reset to 'unclassified' / NULL).
-- topic: read from the opening 300 chars (the subject the post leads with); falls back to decision_record_general / other.
-- Only touches topic = 'unclassified' and cta_stage IS NULL; hand-set values are preserved.
create or replace function public.cw_classify_post_topic(p text) returns text language sql immutable as $$
  select case
    when p is null then 'other'
    when left(p,300) ~* '\m(AI|artificial intelligence|ChatGPT|LLM)\M' then 'ai_in_gmp'
    when left(p,300) ~* 'batch|release' then 'batch_release'
    when left(p,300) ~* '\mCAPA\M' then 'capa_closure'
    when left(p,300) ~* 'deviation|\mOOS\M|\mOOT\M' then 'deviation_oos'
    when left(p,300) ~* 'validation|\mCSV\M|Part 11|Annex 11|GAMP' then 'validation_csv'
    when left(p,300) ~* 'change[- ]control|change approval' then 'change_control'
    when left(p,300) ~* 'supplier' then 'supplier_qualification'
    when left(p,300) ~* 'inspector|inspection|483|warning letter|\mFDA\M' then 'inspection_response'
    when left(p,300) ~* 'cost|expensive|reconstruct|budget' then 'cost_of_weak_record'
    when p ~* 'decision|record|reasoning|signature|authoriz' then 'decision_record_general'
    else 'other' end $$;

create or replace function public.cw_classify_post_cta(p text) returns text language sql immutable as $$
  select case
    when p ~* '\$\s?(497|75)\M|start the record' then 'current_decision'
    when p ~* '/sample|completed (sample|example)|see (a|the) completed|inspect the' then 'skeptical'
    when p ~* 'https?://' then 'problem_aware'
    else 'recognition' end $$;

update public.cw_content_performance
set topic = public.cw_classify_post_topic(post_text)
where channel = 'jmnugent' and is_controlled_test = false and topic = 'unclassified';

update public.cw_content_performance
set cta_stage = public.cw_classify_post_cta(post_text)
where channel = 'jmnugent' and is_controlled_test = false and cta_stage is null;
