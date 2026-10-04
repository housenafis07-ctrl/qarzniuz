create table if not exists public.premium_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trial_used boolean not null default false,
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  premium_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.premium_trials enable row level security;

drop policy if exists "premium_trials_select_own" on public.premium_trials;
create policy "premium_trials_select_own"
on public.premium_trials
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.qz_claim_premium_trial()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  claimed public.premium_trials%rowtype;
  existing public.premium_trials%rowtype;
begin
  if uid is null then
    raise exception 'Sessiya topilmadi';
  end if;

  insert into public.premium_trials (user_id)
  values (uid)
  on conflict (user_id) do nothing;

  update public.premium_trials
     set trial_used = true,
         trial_started_at = coalesce(trial_started_at, now()),
         trial_expires_at = coalesce(trial_expires_at, now() + interval '3 days'),
         premium_until = greatest(
           coalesce(premium_until, '-infinity'::timestamptz),
           coalesce(trial_expires_at, now() + interval '3 days')
         ),
         updated_at = now()
   where user_id = uid
     and trial_used = false
  returning * into claimed;

  if claimed.user_id is not null then
    return jsonb_build_object(
      'granted', true,
      'trial_used', true,
      'started_at', claimed.trial_started_at,
      'expires_at', claimed.trial_expires_at,
      'premium_until', claimed.premium_until
    );
  end if;

  select * into existing
  from public.premium_trials
  where user_id = uid;

  return jsonb_build_object(
    'granted', false,
    'trial_used', coalesce(existing.trial_used, true),
    'started_at', existing.trial_started_at,
    'expires_at', existing.trial_expires_at,
    'premium_until', existing.premium_until
  );
end;
$$;

revoke all on function public.qz_claim_premium_trial() from public;
grant execute on function public.qz_claim_premium_trial() to authenticated;

revoke all on table public.premium_trials from anon;
grant select on table public.premium_trials to authenticated;
