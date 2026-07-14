
create table if not exists public.mailerlite_group_map (
  id uuid primary key default gen_random_uuid(),
  group_key text not null unique,
  group_name text not null,
  mailerlite_group_id text not null unique,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);
