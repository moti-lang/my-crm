-- 0060 — "ניסיון חיוב חוזר" שלא בוצע כי ההוראה ב-SUMIT כבר לא מושבתת: המצב מתעדכן מיד, ונרשם ביומן.
--
-- המקרה (19/11, בנות הוכהייזר): החיוב השני נכשל וההוראה הושבתה (קוד 3). הניה ניסתה קודם את "חיוב חוזר"
-- בממשק של SUMIT — שנכשל ("מוסד / נושא") אבל החזיר את ההוראה למצב פעיל (קוד 0). אחר כך "ניסיון חיוב
-- חוזר" אצלנו סירב בצדק (לא מחייבים במקביל ל-SUMIT) — אבל במסך ההוראה נשארה "הושבתה אחרי כישלון" עד
-- הבדיקה הבאה (עד 20 שעות), ולא נשאר שום תיעוד שהניסיון קרה. "איך אני יודעת אם עבר?"
--
-- עכשיו (rpc_standing_retry_refused, מהפונקציה standing-order-retry, service_role):
--   · המצב מ-SUMIT נקלט מיד — כמו בסנכרון (rpc_standing_billing_observed: סטטוס, תאריך הבא, וחיוב
--     שכבר עבר אם יש).
--   · ביומן ההוראה: "חיוב חוזר לא בוצע" — מתי, מי, ולמה (המצב ב-SUMIT).

alter table standing_order_events drop constraint if exists standing_order_events_kind_check;
alter table standing_order_events add constraint standing_order_events_kind_check
  check (kind in ('reschedule', 'sumit_change', 'amount_change', 'retry_charge', 'retry_declined', 'renewed', 'retry_refused'));

create or replace function f_sumit_recurring_label(p_status int) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_status
    when 0 then 'פעילה' when 1 then 'בוטלה' when 3 then 'הושבתה אחרי כישלון' when 9 then 'הסתיימה'
    when 11 then 'בתקופת חסד' when 12 then 'ממתינה לחיוב ראשון' when 13 then 'בוטלה על ידי הלקוחה'
    when 14 then 'ממתינה לניסיון חוזר' else 'במצב לא מוכר' end || ' (קוד ' || coalesce(p_status::text, '—') || ')'
$$;
revoke all on function f_sumit_recurring_label(int) from public, anon, authenticated;

create or replace function rpc_standing_retry_refused(p_id uuid, p_sumit_status int, p_next date, p_prev date, p_final date, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_obs jsonb; v_note text;
begin
  select * into o from standing_orders where id = p_id;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'הוראת הקבע לא נמצאה'); end if;
  -- המצב ב-SUMIT — כמו בסנכרון.
  v_obs := rpc_standing_billing_observed(p_id, p_sumit_status, p_next, p_prev, p_final);
  update standing_orders set last_checked_at = now() where id = p_id;
  v_note := format('לא חויב: ב-SUMIT ההוראה %s', f_sumit_recurring_label(p_sumit_status))
            || case when p_sumit_status = 0 then ' — הופעלה שוב ב-SUMIT, ו-SUMIT תחייב בעצמה במועד הבא' else '' end;
  insert into standing_order_events (standing_order_id, kind, from_date, remaining, actor, actor_label, note)
  values (o.id, 'retry_refused', o.next_billing, o.installments - o.charged_count, p_by,
          coalesce((select full_name from profiles where id = p_by), 'משתמשת לא מזוהה'), v_note);
  select * into o from standing_orders where id = p_id;
  return jsonb_build_object('ok', true, 'status', o.status, 'next', o.next_billing, 'note', v_note, 'observed', v_obs);
end $$;
revoke all on function rpc_standing_retry_refused(uuid, int, date, date, date, uuid) from public, anon, authenticated;
grant execute on function rpc_standing_retry_refused(uuid, int, date, date, date, uuid) to service_role;
