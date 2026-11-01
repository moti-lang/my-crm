-- 0042 — הוראה שנוצרה עכשיו לא נבדקת באותה ריצה.
--
-- ב-1/11 הסנכרון יצר 77 הוראות שהצטברו (קריאה ל-SUMIT לכל אחת), ומיד אחר כך בדק את כל 77
-- (עוד קריאה לכל אחת) — הן נוצרו באותה דקה, ו-last_checked_at היה ריק. עכשיו היצירה נחשבת
-- בדיקה: SUMIT בדיוק אישרה את ההוראה ומסרה את המזהה. הבדיקה הראשונה תהיה כמו לכל הוראה —
-- יום לפני מועד החיוב (או אחרי שבוע). כמו 0041, ועוד last_checked_at ביצירה מוצלחת.

create or replace function rpc_standing_order_created(p_link uuid, p_ok boolean, p_customer_id bigint, p_recurring_id bigint, p_error text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l payment_links%rowtype; s students%rowtype; v_id uuid; v_start date;
begin
  select * into l from payment_links where id = p_link;
  select * into s from students where id = l.student_id;
  v_start := f_link_standing_start(l);
  insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, status, next_billing, charged_count, consent_text, consented_at, last_error, billing_day,
                               last_checked_at)
  values (s.id, l.branch_id, l.id, p_customer_id, p_recurring_id, (s.payment_track ->> 'installment_amount')::numeric,
          (s.payment_track ->> 'installments')::int - 1, (s.payment_track ->> 'installments')::int,
          v_start, case when p_ok then 'active' else 'setup_failed' end,
          case when p_ok then v_start end, 0,
          l.standing_consent_text, l.standing_consented_at, p_error,
          coalesce(case when s.payment_track ->> 'billing_day' ~ '^[0-9]{1,2}$' then (s.payment_track ->> 'billing_day')::int end,
                   extract(day from v_start)::int),
          -- ★ SUMIT בדיוק אישרה את היצירה: אין מה לבדוק עכשיו. הבדיקה הראשונה — סביב מועד החיוב.
          case when p_ok then now() end)
  on conflict (payment_link_id) do nothing
  returning id into v_id;
  if not p_ok then
    insert into system_alerts (kind, severity, title, body, meta)
    values ('standing_order_setup_failed', 'critical', 'הוראת קבע לא נוצרה ב-SUMIT',
            format('%s שילמה את החיוב הראשון, אבל יצירת הוראת הקבע נכשלה: %s. יש ליצור ידנית ב-SUMIT או לפנות להורה.', s.full_name, coalesce(p_error, 'לא ידוע')),
            jsonb_build_object('student_id', s.id, 'link_id', l.id));
  end if;
  return v_id;
end $$;
revoke all on function rpc_standing_order_created(uuid, boolean, bigint, bigint, text) from public, anon, authenticated;
grant execute on function rpc_standing_order_created(uuid, boolean, bigint, bigint, text) to service_role;

