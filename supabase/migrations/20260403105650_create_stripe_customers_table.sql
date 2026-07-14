
create table if not exists public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique references public.contacts(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  customer_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
