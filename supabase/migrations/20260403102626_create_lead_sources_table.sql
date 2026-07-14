
create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source text,
  medium text,
  campaign text,
  content text,
  term text,
  referrer text,
  landing_page text,
  first_touch boolean not null default false,
  captured_at timestamptz not null default now()
);

create index if not exists lead_sources_contact_id_idx on public.lead_sources(contact_id);
