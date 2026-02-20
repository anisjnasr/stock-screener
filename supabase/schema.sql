-- Run this in Supabase SQL Editor (Dashboard -> SQL Editor -> New query)
-- Then copy .env.example to .env.local and fill in SUPABASE_URL and SUPABASE_SERVICE_KEY from Project Settings -> API

-- Watchlists
create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Watchlist',
  created_at timestamptz not null default now()
);

create table if not exists watchlist_items (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  symbol text not null,
  added_at timestamptz not null default now(),
  unique(watchlist_id, symbol)
);

-- Position lists (same idea as watchlists, with optional qty/price)
create table if not exists position_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Positions',
  created_at timestamptz not null default now()
);

create table if not exists position_items (
  id uuid primary key default gen_random_uuid(),
  position_list_id uuid not null references position_lists(id) on delete cascade,
  symbol text not null,
  quantity numeric,
  entry_price numeric,
  added_at timestamptz not null default now()
);

-- Saved prompts for custom AI subpages
create table if not exists saved_prompts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt_text text not null default '',
  created_at timestamptz not null default now()
);

-- Optional: api_keys for multiple access keys (friend1, friend2). Validate in app by hashing and comparing.
-- For simplicity you can use a single APP_API_KEY in env and skip this table.
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null,
  label text,
  created_at timestamptz not null default now()
);

-- RLS: only service_role can access (your API uses service key). No anon access.
alter table watchlists enable row level security;
alter table watchlist_items enable row level security;
alter table position_lists enable row level security;
alter table position_items enable row level security;
alter table saved_prompts enable row level security;
alter table api_keys enable row level security;

-- No policies = no direct anon/authenticated access. Only service_role (backend) can read/write.
-- Supabase client created with SUPABASE_SERVICE_KEY bypasses RLS.
