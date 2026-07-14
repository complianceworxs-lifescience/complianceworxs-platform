
create table if not exists public.lead_intents (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  assessment_started boolean not null default false,
  assessment_completed boolean not null default false,
  lock_viewed boolean not null default false,
  cta_clicked boolean not null default false,
  return_visits integer not null default 0,
  high_intent boolean not null default false,
  last_case_file_slug text,
  last_case_file_title text,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contact_id)
);
