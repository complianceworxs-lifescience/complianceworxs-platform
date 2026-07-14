
create table if not exists public.integration_sync_queue (
  id uuid primary key default gen_random_uuid(),
  integration_name text not null,
  event_type text not null,
  contact_id uuid references public.contacts(id) on delete cascade,
  entity_type text not null,
  entity_id text,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  processed_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_sync_queue_status_idx
  on public.integration_sync_queue (integration_name, status, next_attempt_at, created_at);
