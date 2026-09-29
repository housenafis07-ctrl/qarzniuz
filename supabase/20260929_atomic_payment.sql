-- QarzniUz P0: atomic payment recording.
-- Concurrent payments for the same customer are serialized by locking
-- that customer's row before calculating the current balance.

create or replace function public.qz_record_payment(
  p_shop_id uuid,
  p_customer_id uuid,
  p_debt_id uuid default null,
  p_amount numeric default 0,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.shop_customers%rowtype;
  v_member public.shop_members%rowtype;
  v_payment public.shop_payments%rowtype;
  v_debt_total numeric(14,2);
  v_paid_total numeric(14,2);
  v_balance numeric(14,2);
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'Sessiya topilmadi';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'To''lov summasi 0 dan katta bo''lishi kerak';
  end if;

  if p_amount > 999999999999.99 then
    raise exception 'To''lov summasi juda katta';
  end if;

  select *
    into v_member
  from public.shop_members
  where shop_id = p_shop_id
    and user_id = auth.uid()
    and status = 'active'
  limit 1;

  if not found then
    raise exception 'Do''kon a''zoligi topilmadi yoki faol emas';
  end if;

  -- The customer row is the serialization point. Every payment for the
  -- same customer must acquire this lock before reading the balance.
  select *
    into v_customer
  from public.shop_customers
  where id = p_customer_id
    and shop_id = p_shop_id
  for update;

  if not found then
    raise exception 'Mijoz topilmadi';
  end if;

  if p_debt_id is not null and not exists (
    select 1
    from public.shop_debts d
    where d.id = p_debt_id
      and d.shop_id = p_shop_id
      and d.customer_id = p_customer_id
  ) then
    raise exception 'Qarz yozuvi mijozga tegishli emas';
  end if;

  select coalesce(sum(d.amount), 0)::numeric(14,2)
    into v_debt_total
  from public.shop_debts d
  where d.shop_id = p_shop_id
    and d.customer_id = p_customer_id
    and d.status = 'active';

  select coalesce(sum(p.amount), 0)::numeric(14,2)
    into v_paid_total
  from public.shop_payments p
  where p.shop_id = p_shop_id
    and p.customer_id = p_customer_id
    and p.status = 'recorded';

  v_balance := round(v_debt_total - v_paid_total, 2);

  if v_balance <= 0 then
    raise exception 'Bu mijozda faol qarz yo''q';
  end if;

  if p_amount > v_balance + 0.009 then
    raise exception 'To''lov qoldiq qarzdan katta bo''lishi mumkin emas';
  end if;

  v_note := nullif(left(coalesce(p_note, ''), 500), '');

  insert into public.shop_payments (
    shop_id,
    customer_id,
    debt_id,
    amount,
    note,
    status,
    created_by
  )
  values (
    p_shop_id,
    p_customer_id,
    p_debt_id,
    round(p_amount, 2),
    v_note,
    'recorded',
    auth.uid()
  )
  returning * into v_payment;

  insert into public.shop_audit_logs (
    shop_id,
    actor_user_id,
    actor_name,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data
  )
  values (
    p_shop_id,
    auth.uid(),
    v_member.full_name,
    'CREATE',
    'PAYMENT',
    v_payment.id,
    null,
    to_jsonb(v_payment)
  );

  return jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'balance', round(v_balance - v_payment.amount, 2)
  );
end;
$$;

revoke all on function public.qz_record_payment(uuid, uuid, uuid, numeric, text) from public;
grant execute on function public.qz_record_payment(uuid, uuid, uuid, numeric, text) to authenticated;
