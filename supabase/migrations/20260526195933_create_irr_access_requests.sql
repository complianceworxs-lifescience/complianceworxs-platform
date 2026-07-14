create table if not exists public.irr_access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  decision_type text not null,
  industry text not null,
  context text,
  referrer text,
  session_source jsonb,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists irr_access_requests_decision_industry_idx
  on public.irr_access_requests (decision_type, industry);

create index if not exists irr_access_requests_created_at_idx
  on public.irr_access_requests (created_at desc);

alter table public.irr_access_requests enable row level security;

create policy "service role full access"
  on public.irr_access_requests
  for all
  to service_role
  using (true)
  with check (true);