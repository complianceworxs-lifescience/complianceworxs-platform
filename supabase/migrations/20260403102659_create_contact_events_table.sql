
create table if not exists public.contact_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete cascade,
  event_name text not null,
  event_source text not null,
  event_timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists contact_events_contact_id_idx on public.contact_events(contact_id);
create index if not exists contact_events_event_name_idx on public.contact_events(event_name);
