
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  normalized_email text not null unique,
  full_name text,
  first_name text,
  last_name text,
  company text,
  job_title text,
  phone text,
  lifecycle_stage text not null default 'lead',
  consent_status text not null default 'subscribed',
  consent_source text,
  consent_timestamp timestamptz,
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  mailerlite_subscriber_id text,
  stripe_customer_id text,
  attio_person_id text,
  posthog_distinct_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_lifecycle_stage_idx on public.contacts(lifecycle_stage);
create index if not exists contacts_company_idx on public.contacts(company);
