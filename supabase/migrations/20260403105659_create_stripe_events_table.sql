
create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  api_version text,
  object_id text,
  livemode boolean,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_status text not null default 'received',
  process_error text
);

create index if not exists stripe_events_type_idx on public.stripe_events (event_type, received_at);
