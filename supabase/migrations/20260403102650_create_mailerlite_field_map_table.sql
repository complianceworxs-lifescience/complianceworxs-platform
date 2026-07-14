
create table if not exists public.mailerlite_field_map (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  field_name text not null,
  mailerlite_field_id text not null unique,
  field_type text not null,
  active boolean not null default true,
  synced_at timestamptz not null default now()
);
