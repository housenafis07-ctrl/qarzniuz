-- QarzniUz: the application creates the OWNER membership explicitly in api/shop.py.
-- The legacy shops trigger attempted to create a duplicate membership and used
-- the old lowercase role value ("owner"), which violates shop_members_role_check.
-- Keep the trigger for compatibility but make it a safe no-op.
create or replace function public.create_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;