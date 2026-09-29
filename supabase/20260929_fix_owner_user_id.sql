-- QarzniUz P0 schema fix: standardize shops.owner_user_id
-- Safe for an existing database that may still have legacy shops.owner_id.
-- Run this once in Supabase SQL Editor before deploying the matching app code.

begin;

do $$
declare
  has_owner_id boolean;
  has_owner_user_id boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shops'
      and column_name = 'owner_id'
  ) into has_owner_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shops'
      and column_name = 'owner_user_id'
  ) into has_owner_user_id;

  if has_owner_id and not has_owner_user_id then
    alter table public.shops rename column owner_id to owner_user_id;

  elsif has_owner_id and has_owner_user_id then
    update public.shops
       set owner_user_id = owner_id
     where owner_user_id is null;

    if exists (
      select 1
      from public.shops
      where owner_user_id is distinct from owner_id
    ) then
      raise exception 'shops.owner_id and shops.owner_user_id contain conflicting values; migration stopped';
    end if;

    alter table public.shops drop column owner_id;
  end if;
end
$$;

alter table public.shops
  alter column owner_user_id set not null;

commit;
