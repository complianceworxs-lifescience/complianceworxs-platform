
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete restrict,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  order_status text not null,
  product_type text not null,
  product_sku text not null,
  product_slug text,
  amount_cents integer not null,
  currency text not null default 'usd',
  purchased_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_contact_id_idx on public.orders(contact_id);
create index if not exists orders_product_sku_idx on public.orders(product_sku);
