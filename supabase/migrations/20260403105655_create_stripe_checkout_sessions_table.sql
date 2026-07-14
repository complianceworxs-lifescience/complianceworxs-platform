
create table if not exists public.stripe_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.contacts(id) on delete set null,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_payment_status text,
  stripe_status text,
  amount_total integer,
  currency text,
  mode text,
  success_url text,
  cancel_url text,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
