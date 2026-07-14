
create table if not exists public.webhook_events_raw (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_name text,
  dedupe_key text not null unique,
  headers jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists webhook_events_raw_provider_idx on public.webhook_events_raw(provider);
create index if not exists webhook_events_raw_processed_idx on public.webhook_events_raw(processed);
