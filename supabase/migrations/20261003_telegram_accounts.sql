-- Telegram Mini App account linking
-- This migration is intentionally isolated from existing QarzniUz tables.

create table if not exists public.telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  telegram_username text,
  telegram_first_name text,
  telegram_last_name text,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_accounts_user_id_idx
  on public.telegram_accounts(user_id);

alter table public.telegram_accounts enable row level security;

drop policy if exists "telegram_accounts_select_own" on public.telegram_accounts;
create policy "telegram_accounts_select_own"
  on public.telegram_accounts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Writes are intentionally handled by the server endpoint.
-- Do not expose INSERT/UPDATE/DELETE policies to browser clients.
