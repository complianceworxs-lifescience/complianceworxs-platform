create table if not exists runtime_generations (
  generation_id uuid primary key,
  status text not null default 'pending',
  package_checksum text,
  artifact jsonb,
  runtime_manifest jsonb,
  issues jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runtime_generations_status_idx on runtime_generations (status, created_at);