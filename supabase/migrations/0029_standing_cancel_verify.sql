-- 0029 — אחרי עצירה: מוודאים מול SUMIT שההוראה באמת בוטלה שם.
--
-- הוראה שסומנה "נעצרה" אצלנו ממשיכה להיבדק 14 יום. אם SUMIT עדיין מדווחת
-- עליה כפעילה / בניסיון חוזר — התראה קריטית (פעם ביום), כי החיובים ימשיכו.
-- חיוב שבכל זאת נקלט על הוראה שנעצרה — נרשם (הכסף נגבה), והבעלים יודעת.

create or replace function rpc_standing_orders_to_check() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'customer_id', o.sumit_customer_id, 'recurring_id', o.sumit_recurring_id,
           'amount', o.amount, 'date_start', o.date_start, 'last_checked_at', o.last_checked_at, 'status', o.status)), '[]'::jsonb)
  from standing_orders o
  where o.sumit_recurring_id is not null
    and (o.status in ('active', 'retrying', 'failed')
         or (o.status = 'cancelled' and o.cancelled_at > now() - interval '14 days'))
$$;
revoke all on function rpc_standing_orders_to_check() from public, anon, authenticated;
grant execute on function rpc_standing_orders_to_check() to service_role;

create or replace function rpc_standing_order_status(p_id uuid, p_sumit_status int, p_next date, p_last date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_new text; v_name text;
begin
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then return jsonb_build_object('ok', false); end if;
  v_new := coalesce(f_standing_status(p_sumit_status), o.status);
  select full_name into v_name from students where id = o.student_id;

  -- ★ נעצרה אצלנו — אבל SUMIT עדיין מחייבת. לא "מחזירים" אותה לפעילה; מתריעים.
  if o.status = 'cancelled' then
    update standing_orders set sumit_status = p_sumit_status, next_billing = case when v_new = 'cancelled' then null else p_next end,
           last_checked_at = now() where id = o.id;
    if v_new in ('active', 'retrying', 'failed')
       and not exists (select 1 from system_alerts where kind = 'standing_order_cancel_mismatch'
                        and meta ->> 'standing_order_id' = o.id::text and created_at > now() - interval '1 day') then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_cancel_mismatch', 'critical', 'הוראת קבע נעצרה אצלנו אבל עדיין פעילה ב-SUMIT',
              format('%s: SUMIT מדווחת על ההוראה כפעילה (קוד %s, חיוב הבא %s). יש לבטל ידנית ב-SUMIT.', v_name, p_sumit_status,
                     coalesce(to_char(p_next, 'DD/MM/YYYY'), '—')),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_status', p_sumit_status));
    end if;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'confirmed_in_sumit', v_new = 'cancelled');
  end if;

  update standing_orders set sumit_status = p_sumit_status, status = v_new, next_billing = p_next,
         last_billing = coalesce(p_last, last_billing), last_checked_at = now(),
         cancelled_at = case when v_new = 'cancelled' and cancelled_at is null then now() else cancelled_at end
   where id = o.id;
  if v_new <> o.status then
    if v_new in ('failed', 'retrying') then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_failed', case when v_new = 'failed' then 'critical' else 'warning' end,
              case when v_new = 'failed' then 'הוראת קבע הושבתה אחרי חיוב שנכשל' else 'חיוב בהוראת קבע נדחה — SUMIT תנסה שוב' end,
              format('%s: %s. התלמידה נשארת פעילה. כדאי ליצור קשר עם ההורה (ייתכן כרטיס שפג תוקפו).', v_name,
                     case when v_new = 'failed' then 'SUMIT הפסיקה לחייב' else 'החיוב לא עבר' end),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id, 'sumit_status', p_sumit_status));
    elsif v_new = 'cancelled' then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('standing_order_cancelled', 'warning', 'הוראת קבע בוטלה ב-SUMIT',
              format('%s: הוראת הקבע בוטלה ב-SUMIT (קוד %s). החיובים הבאים לא ייגבו.', v_name, p_sumit_status),
              jsonb_build_object('standing_order_id', o.id, 'student_id', o.student_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', v_new, 'changed', v_new <> o.status);
end $$;
revoke all on function rpc_standing_order_status(uuid, int, date, date) from public, anon, authenticated;
grant execute on function rpc_standing_order_status(uuid, int, date, date) to service_role;
