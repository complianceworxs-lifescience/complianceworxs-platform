
create table if not exists public.mailerlite_sync_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  event_type text not null,
  event_key text not null unique,
  payload jsonb not null,
  status text not null default 'pending',
  retry_count integer not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mailerlite_sync_events_status_idx on public.mailerlite_sync_events(status);
create index if not exists mailerlite_sync_events_contact_id_idx on public.mailerlite_sync_events(contact_id);
