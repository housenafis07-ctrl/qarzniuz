-- QarzniUz Owner/Seller RLS hardening
-- Safe/idempotent: run in Supabase SQL Editor after the shop tables exist.

begin;

create or replace function public.qz_shop_role(target_shop uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select m.role
  from public.shop_members m
  where m.shop_id = target_shop
    and m.user_id = auth.uid()
    and m.status = 'active'
  order by case when m.role = 'OWNER' then 0 else 1 end
  limit 1
$$;

alter function public.qz_shop_role(uuid) owner to postgres;

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_customers enable row level security;
alter table public.shop_debts enable row level security;
alter table public.shop_payments enable row level security;
alter table public.shop_audit_logs enable row level security;

drop policy if exists qz_shops_select on public.shops;
create policy qz_shops_select on public.shops
for select using (owner_id = auth.uid() or public.qz_shop_role(id) is not null);

drop policy if exists qz_shops_insert on public.shops;
create policy qz_shops_insert on public.shops
for insert with check (owner_id = auth.uid());

drop policy if exists qz_shops_update on public.shops;
create policy qz_shops_update on public.shops
for update using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists qz_shop_members_select on public.shop_members;
create policy qz_shop_members_select on public.shop_members
for select using (user_id = auth.uid() or public.qz_shop_role(shop_id) = 'OWNER');

drop policy if exists qz_shop_members_insert on public.shop_members;
create policy qz_shop_members_insert on public.shop_members
for insert with check (
  (
    role = 'OWNER'
    and user_id = auth.uid()
    and exists (
      select 1 from public.shops s
      where s.id = shop_members.shop_id
        and s.owner_id = auth.uid()
    )
  )
  or (role = 'SELLER' and public.qz_shop_role(shop_id) = 'OWNER')
);

drop policy if exists qz_shop_members_update on public.shop_members;
create policy qz_shop_members_update on public.shop_members
for update using (user_id = auth.uid() or public.qz_shop_role(shop_id) = 'OWNER')
with check (user_id = auth.uid() or public.qz_shop_role(shop_id) = 'OWNER');

drop policy if exists qz_shop_customers_select on public.shop_customers;
create policy qz_shop_customers_select on public.shop_customers
for select using (public.qz_shop_role(shop_id) is not null);

drop policy if exists qz_shop_customers_insert on public.shop_customers;
create policy qz_shop_customers_insert on public.shop_customers
for insert with check (
  public.qz_shop_role(shop_id) is not null
  and created_by = auth.uid()
);

drop policy if exists qz_shop_customers_update on public.shop_customers;
create policy qz_shop_customers_update on public.shop_customers
for update using (public.qz_shop_role(shop_id) = 'OWNER')
with check (public.qz_shop_role(shop_id) = 'OWNER');

drop policy if exists qz_shop_debts_select on public.shop_debts;
create policy qz_shop_debts_select on public.shop_debts
for select using (public.qz_shop_role(shop_id) is not null);

drop policy if exists qz_shop_debts_insert on public.shop_debts;
create policy qz_shop_debts_insert on public.shop_debts
for insert with check (
  public.qz_shop_role(shop_id) is not null
  and created_by = auth.uid()
);

drop policy if exists qz_shop_debts_update on public.shop_debts;
create policy qz_shop_debts_update on public.shop_debts
for update using (public.qz_shop_role(shop_id) = 'OWNER')
with check (public.qz_shop_role(shop_id) = 'OWNER');

drop policy if exists qz_shop_payments_select on public.shop_payments;
create policy qz_shop_payments_select on public.shop_payments
for select using (public.qz_shop_role(shop_id) is not null);

drop policy if exists qz_shop_payments_insert on public.shop_payments;
create policy qz_shop_payments_insert on public.shop_payments
for insert with check (
  public.qz_shop_role(shop_id) is not null
  and created_by = auth.uid()
);

drop policy if exists qz_shop_payments_update on public.shop_payments;
create policy qz_shop_payments_update on public.shop_payments
for update using (public.qz_shop_role(shop_id) = 'OWNER')
with check (public.qz_shop_role(shop_id) = 'OWNER');

drop policy if exists qz_shop_audit_select on public.shop_audit_logs;
create policy qz_shop_audit_select on public.shop_audit_logs
for select using (public.qz_shop_role(shop_id) = 'OWNER');

drop policy if exists qz_shop_audit_insert on public.shop_audit_logs;
create policy qz_shop_audit_insert on public.shop_audit_logs
for insert with check (
  public.qz_shop_role(shop_id) is not null
  and actor_user_id = auth.uid()
);

commit;
