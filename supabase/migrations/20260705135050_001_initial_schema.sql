-- ============================================================
-- ComplianceWorxs Commercial Operating System — Phase 1 Schema
-- Migration: 001_initial_schema
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table beliefs (
  belief_id        uuid primary key default gen_random_uuid(),
  belief_statement text not null,
  status           text not null default 'active'
                     check (status in ('active','retired')),
  created_at       timestamptz not null default now()
);

create table objections (
  objection_id        uuid primary key default gen_random_uuid(),
  objection_statement  text not null,
  belief_id            uuid references beliefs(belief_id),
  frequency            int not null default 0,
  created_at           timestamptz not null default now()
);

create table market_signals (
  signal_id         uuid primary key default gen_random_uuid(),
  attio_company_id  uuid,
  signal_type       text not null
                      check (signal_type in
                        ('warning_letter','form_483','recall',
                         'consent_decree','product_hold',
                         'executive_turnover','tech_transfer',
                         'ma_due_diligence','other')),
  source_url        text not null,
  signal_date        date,
  summary            text,
  relevance_score    numeric check (relevance_score between 0 and 1),
  created_at         timestamptz not null default now()
);

create table activation_events (
  activation_event_id uuid primary key default gen_random_uuid(),
  signal_id            uuid references market_signals(signal_id),
  attio_company_id     uuid,
  event_type           text,
  urgency_level        text check (urgency_level in ('low','medium','high')),
  decision_type        text,
  executive_concern     text,
  created_at            timestamptz not null default now()
);

create table campaigns (
  campaign_id           uuid primary key default gen_random_uuid(),
  belief_id             uuid references beliefs(belief_id) not null,
  objection_id          uuid references objections(objection_id) not null,
  activation_event_id   uuid references activation_events(activation_event_id),
  decision_type         text not null,
  campaign_thesis        text,
  behavioral_commitment   text,
  status                 text not null default 'draft'
                           check (status in ('draft','approved','active','killed')),
  success_metric          text,
  created_at              timestamptz not null default now(),
  constraint check_campaign_readiness
    check (status != 'active' or
           (belief_id is not null and objection_id is not null
            and decision_type is not null
            and behavioral_commitment is not null and behavioral_commitment != ''))
);

create table assets (
  asset_id               uuid primary key default gen_random_uuid(),
  campaign_id            uuid references campaigns(campaign_id) not null,
  asset_type             text not null
                           check (asset_type in
                             ('executive_article','practitioner_article',
                              'executive_brief','case_file_outline',
                              'irr_demo_outline','linkedin_post',
                              'outbound_email')),
  objection_removed      uuid references objections(objection_id) not null,
  belief_reinforced      uuid references beliefs(belief_id) not null,
  content                text,
  requires_framework_review boolean not null default false,
  framework_approved_by   text,
  framework_approved_at   timestamptz,
  published_approved_by   text not null default '',
  published_approved_at   timestamptz,
  banned_language_found    boolean not null default false,
  approval_status          text not null default 'pending'
                             check (approval_status in
                               ('pending','framework_approved','approved','rejected')),
  created_at                timestamptz not null default now(),
  constraint check_publish_gate
    check (approval_status != 'approved'
           or (published_approved_by != '' and banned_language_found = false)),
  constraint check_framework_gate
    check (not requires_framework_review
           or approval_status = 'pending'
           or framework_approved_by is not null)
);

create or replace function check_banned_language(body text) returns boolean as $$
  select body ~* '\y(DDR|Decision Defense Record|decision defensibility|authorization framework|leverage|automation)\y'
      or body ~* '\bplatform\b'
      or body ~* '\bAI\b';
$$ language sql immutable;

create or replace function set_banned_language_flag() returns trigger as $$
begin
  new.banned_language_found := check_banned_language(coalesce(new.content, ''));
  return new;
end;
$$ language plpgsql;

create trigger trg_set_banned_language_flag
  before insert or update of content on assets
  for each row
  execute function set_banned_language_flag();

create table campaign_review_findings (
  review_id                  uuid primary key default gen_random_uuid(),
  asset_id                    uuid references assets(asset_id) not null,
  strengths                    text,
  weaknesses                    text,
  constitution_observations      jsonb,
  cos_observations                 jsonb,
  category_observations              text,
  suggested_revisions                  text,
  overall_confidence                    numeric check (overall_confidence between 0 and 1),
  created_at                              timestamptz not null default now()
);

create index idx_review_findings_asset on campaign_review_findings(asset_id);

create table interactions (
  interaction_id             uuid primary key default gen_random_uuid(),
  attio_person_id             uuid,
  campaign_id                 uuid references campaigns(campaign_id),
  interaction_type            text,
  dominant_unresolved_belief  text,
  primary_objection            text,
  activation_event             text,
  behavioral_commitment         text,
  behavioral_commitment_strength text
    check (behavioral_commitment_strength in ('none','weak','moderate','strong')),
  notes                          text,
  occurred_at                     timestamptz not null default now()
);

create table commercial_outcomes (
  outcome_id       uuid primary key default gen_random_uuid(),
  attio_company_id uuid,
  campaign_id       uuid references campaigns(campaign_id),
  outcome_type      text not null
                      check (outcome_type in
                        ('exec_meeting','irr_started','irr_sold',
                         'membership_discussion','membership_closed')),
  value              numeric,
  occurred_at         timestamptz not null default now()
);

create table ai_service_log (
  log_id           uuid primary key default gen_random_uuid(),
  service_name     text not null,
  input            jsonb,
  output           jsonb,
  model            text not null default 'claude',
  prompt_version   text not null,
  approval_status  text,
  error_state      text,
  redacted_at       timestamptz,
  created_at         timestamptz not null default now()
);

create or replace function redact_old_ai_logs() returns void as $$
begin
  update ai_service_log
    set input = null,
        output = null,
        redacted_at = now()
    where created_at < now() - interval '180 days'
      and redacted_at is null;
end;
$$ language plpgsql;

select cron.schedule(
  'redact-ai-logs-daily',
  '0 3 * * *',
  'select redact_old_ai_logs();'
);

create index idx_campaigns_status on campaigns(status);
create index idx_assets_campaign on assets(campaign_id);
create index idx_assets_approval on assets(approval_status);
create index idx_assets_belief on assets(belief_reinforced);
create index idx_interactions_campaign on interactions(campaign_id);
create index idx_outcomes_campaign on commercial_outcomes(campaign_id);
create index idx_outcomes_type on commercial_outcomes(outcome_type);
create index idx_ai_log_created on ai_service_log(created_at);
create index idx_ai_log_redacted on ai_service_log(redacted_at);