-- QarzniUz shared-shop Owner/Seller model
create extension if not exists pgcrypto;

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid,
  phone text not null,
  full_name text not null,
  role text not null default 'SELLER' check (role in ('OWNER','SELLER')),
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id, phone)
);
create unique index if not exists shop_members_user_unique on public.shop_members(shop_id, user_id) where user_id is not null;

create table if not exists public.shop_customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  full_name text not null,
  phone text,
  note text,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_debts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.shop_customers(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  due_date date,
  status text not null default 'active' check (status in ('active','cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null references public.shop_customers(id) on delete restrict,
  debt_id uuid references public.shop_debts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  note text,
  status text not null default 'recorded' check (status in ('recorded','cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_audit_logs (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  actor_user_id uuid not null,
  actor_name text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shop_members_shop_idx on public.shop_members(shop_id);
create index if not exists shop_members_phone_idx on public.shop_members(phone);
create index if not exists shop_customers_shop_idx on public.shop_customers(shop_id);
create index if not exists shop_debts_shop_customer_idx on public.shop_debts(shop_id, customer_id);
create index if not exists shop_payments_shop_customer_idx on public.shop_payments(shop_id, customer_id);
create index if not exists shop_audit_shop_created_idx on public.shop_audit_logs(shop_id, created_at desc);

create or replace function public.qz_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists shops_touch on public.shops;
create trigger shops_touch before update on public.shops for each row execute function public.qz_touch_updated_at();
drop trigger if exists shop_members_touch on public.shop_members;
create trigger shop_members_touch before update on public.shop_members for each row execute function public.qz_touch_updated_at();
drop trigger if exists shop_customers_touch on public.shop_customers;
create trigger shop_customers_touch before update on public.shop_customers for each row execute function public.qz_touch_updated_at();

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_customers enable row level security;
alter table public.shop_debts enable row level security;
alter table public.shop_payments enable row level security;
alter table public.shop_audit_logs enable row level security;

create or replace function public.qz_is_shop_member(p_shop_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.shop_members m where m.shop_id=p_shop_id and m.user_id=auth.uid() and m.status='active');
$$;
create or replace function public.qz_is_shop_owner(p_shop_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.shop_members m where m.shop_id=p_shop_id and m.user_id=auth.uid() and m.role='OWNER' and m.status='active');
$$;

drop policy if exists qz_shops_select on public.shops;
create policy qz_shops_select on public.shops for select using (public.qz_is_shop_member(id));
drop policy if exists qz_members_select on public.shop_members;
create policy qz_members_select on public.shop_members for select using (public.qz_is_shop_member(shop_id));
drop policy if exists qz_members_owner_write on public.shop_members;
create policy qz_members_owner_write on public.shop_members for all using (public.qz_is_shop_owner(shop_id)) with check (public.qz_is_shop_owner(shop_id));
drop policy if exists qz_customers_select on public.shop_customers;
create policy qz_customers_select on public.shop_customers for select using (public.qz_is_shop_member(shop_id));
drop policy if exists qz_customers_insert on public.shop_customers;
create policy qz_customers_insert on public.shop_customers for insert with check (public.qz_is_shop_member(shop_id) and created_by=auth.uid());
drop policy if exists qz_customers_update on public.shop_customers;
create policy qz_customers_update on public.shop_customers for update using (public.qz_is_shop_member(shop_id)) with check (public.qz_is_shop_member(shop_id));
drop policy if exists qz_debts_select on public.shop_debts;
create policy qz_debts_select on public.shop_debts for select using (public.qz_is_shop_member(shop_id));
drop policy if exists qz_debts_insert on public.shop_debts;
create policy qz_debts_insert on public.shop_debts for insert with check (public.qz_is_shop_member(shop_id) and created_by=auth.uid());
drop policy if exists qz_payments_select on public.shop_payments;
create policy qz_payments_select on public.shop_payments for select using (public.qz_is_shop_member(shop_id));
drop policy if exists qz_payments_insert on public.shop_payments;
create policy qz_payments_insert on public.shop_payments for insert with check (public.qz_is_shop_member(shop_id) and created_by=auth.uid());
drop policy if exists qz_audit_select on public.shop_audit_logs;
create policy qz_audit_select on public.shop_audit_logs for select using (public.qz_is_shop_member(shop_id));

-- Sellers do not delete historical debts/payments/audit records.
-- Owner corrections should use status changes plus an audit record.
