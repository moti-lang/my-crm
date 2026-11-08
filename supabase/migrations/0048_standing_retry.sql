-- 0048 — ניסיון חיוב חוזר בהוראת קבע שהושבתה אחרי חיוב שנכשל (SUMIT: סטטוס 3).
--
-- המקרה (תמר וינשטוק, 6/11): חיוב חודשי נדחה, ו-SUMIT השביתה את ההוראה. הכרטיס שמור אצל הלקוחה
-- ב-SUMIT (שולם איתו התשלום הראשון), אז אפשר לנסות שוב על אותו כרטיס — בלי לפנות להורה.
--
-- הבעלים לוחצת "ניסיון חיוב חוזר" (הזרימה ב-_shared/standing-retry.ts, הפונקציה standing-order-retry):
--   1. התוכנית — כאן (f_standing_retry_plan): כמה, ומה יקרה אם יעבור. רק בעלים.
--   2. SUMIT: ההוראה שלנו, ובמצב "הושבתה אחרי כישלון" (3). אחרת לא מחייבים (SUMIT אולי מנסה בעצמה).
--   3. חיוב אחד על הכרטיס השמור (payments/charge, בלי פרטי כרטיס) → נרשם כאן (rpc_standing_retry_charged):
--      עבר — תשלום, "חיוב X מתוך N", ויומן; נדחה — היומן והסיבה מחברת האשראי, ושום דבר אחר לא משתנה.
--      לא ברור אם חויב — retry_uncertain_at: אין ניסיון נוסף 24 שעות (חיוב כפול), והבעלים יודעת.
--   4. עבר ונשארו חיובים — הוראה חדשה ב-SUMIT לחיובים שנותרו, מהחודש הבא ביום החיוב
--      (rpc_standing_retry_renewed). ★ אם החידוש נכשל אחרי שהחיוב עבר — needs_renewal: הלחיצה הבאה
--      רק מחדשת, בלי חיוב נוסף.

alter table standing_orders add column if not exists needs_renewal boolean not null default false;
-- ★ ניסיון שלא ברור אם חויב (החיבור נפל אחרי השליחה): אין ניסיון נוסף 24 שעות — קודם בודקים ב-SUMIT.
alter table standing_orders add column if not exists retry_uncertain_at timestamptz;

alter table standing_order_events drop constraint if exists standing_order_events_kind_check;
alter table standing_order_events add constraint standing_order_events_kind_check
  check (kind in ('reschedule', 'sumit_change', 'amount_change', 'retry_charge', 'retry_declined', 'renewed'));
alter table standing_order_events add column if not exists note text;

create or replace view v_standing_order_events as
select e.id, e.standing_order_id, o.student_id, s.full_name, o.branch_id, b.name as branch_name, e.kind,
       e.from_date, e.to_date, e.from_day, e.to_day, e.remaining, e.actor_label, e.created_at, e.from_amount, e.to_amount, e.note
from standing_order_events e
join standing_orders o on o.id = e.standing_order_id
join students s on s.id = o.student_id
join branches b on b.id = o.branch_id
where auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and o.branch_id in (select my_branches()));
alter view v_standing_order_events set (security_invoker = false);
revoke all on v_standing_order_events from anon, public;
grant select on v_standing_order_events to authenticated;

-- ─────────── התוכנית ───────────
-- stage 'charge': חיוב חוזר ואז חידוש · 'renew': החיוב כבר עבר, נשאר רק לחדש (בלי חיוב).
create or replace function f_standing_retry_plan(p_id uuid, p_today date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_stage text; v_day int; v_before int; v_after int; v_last date; v_next date; v_final date;
        v_lines text[]; v_paid date; v_charged date; v_renewal text;
begin
  select * into o from standing_orders where id = p_id;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'הוראת הקבע לא נמצאה'); end if;
  if o.sumit_recurring_id is null then return jsonb_build_object('ok', false, 'error', 'להוראה הזו אין מזהה ב-SUMIT'); end if;
  if not o.needs_renewal and o.status <> 'failed' then
    return jsonb_build_object('ok', false, 'error', case o.status
      when 'active' then 'ההוראה פעילה — אין חיוב שנכשל לנסות שוב'
      when 'retrying' then 'SUMIT עוד מנסה לחייב בעצמה (ניסיון חוזר / תקופת חסד) — לא מחייבים במקביל'
      when 'setup_failed' then 'ההוראה לא נוצרה ב-SUMIT — אין כרטיס שמור לחייב'
      else 'הוראת הקבע אינה פעילה' end);
  end if;
  v_stage := case when o.needs_renewal then 'renew' else 'charge' end;
  if v_stage = 'charge' and o.retry_uncertain_at > now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'error', format(
      'בניסיון הקודם (%s) לא ברור אם החיוב בוצע. לבדוק ב-SUMIT אם נוצר תשלום; ניסיון נוסף אפשר מ-%s.',
      to_char(o.retry_uncertain_at at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI'),
      to_char((o.retry_uncertain_at + interval '24 hours') at time zone 'Asia/Jerusalem', 'DD/MM HH24:MI')));
  end if;
  v_before := o.installments - o.charged_count;
  if v_stage = 'charge' and v_before <= 0 then return jsonb_build_object('ok', false, 'error', 'כל החיובים בהוראה כבר בוצעו'); end if;
  v_after := v_before - case when v_stage = 'charge' then 1 else 0 end;
  v_day := coalesce(o.billing_day, extract(day from o.date_start)::int);

  -- ★ החיוב האחרון: בחיוב — היום (אם יעבור). בחידוש — החיוב החוזר שכבר עבר (ולא מה ש-SUMIT מדווחת
  --   על ההוראה הישנה), כדי שההוראה החדשה לא תחייב שוב באותו חודש.
  if v_stage = 'charge' then v_last := p_today;
  else
    select (l.paid_at at time zone 'Asia/Jerusalem')::date into v_paid from payment_links l where l.id = o.payment_link_id;
    select max((c.charged_at at time zone 'Asia/Jerusalem')::date) into v_charged from standing_order_charges c where c.standing_order_id = o.id and c.valid;
    v_last := greatest(o.last_billing, v_paid, v_charged);
  end if;
  if v_after > 0 then
    v_next := f_standing_next_on_day(v_day, p_today, v_last);
    v_final := (v_next + make_interval(months => v_after - 1))::date;
  end if;

  v_renewal := case when v_after = 0 then 'זה החיוב האחרון בהוראה — אין מה לחדש.'
    when v_after = 1 then format('ההוראה תחודש ב-SUMIT: חיוב אחד אחרון של %s ₪ ב-%s.', trim_scale(o.amount), to_char(v_next, 'DD/MM'))
    else format('ההוראה תחודש ב-SUMIT: %s חיובים של %s ₪, מ-%s, כל %s לחודש (האחרון ב-%s).',
                v_after, trim_scale(o.amount), to_char(v_next, 'DD/MM'), v_day, to_char(v_final, 'DD/MM/YYYY')) end;
  if v_stage = 'charge' then
    v_lines := array[
      format('ננסה לחייב עכשיו %s ₪ בכרטיס השמור של ההורה — החיוב של %s שנכשל.', trim_scale(o.amount), coalesce(to_char(o.next_billing, 'DD/MM'), 'החודש')),
      'אם יעבור: ' || v_renewal,
      'אם לא יעבור: שום דבר לא משתנה, ותופיע הסיבה מחברת האשראי.'];
  else
    v_lines := array['החיוב החוזר כבר עבר ונרשם. נשאר לחדש את ההוראה ב-SUMIT — בלי חיוב נוסף.', v_renewal];
  end if;
  return jsonb_build_object('ok', true, 'stage', v_stage, 'amount', o.amount, 'missed', o.next_billing, 'remaining_after', v_after,
                            'next', v_next, 'final', v_final, 'day', v_day, 'lines', to_jsonb(v_lines));
end $$;
revoke all on function f_standing_retry_plan(uuid, date) from public, anon, authenticated;

-- הבעלים: התוכנית לפני הלחיצה (בלי שום שינוי). הפונקציה standing-order-retry שואלת את אותה תוכנית.
create or replace function rpc_standing_retry_preview(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לנסות חיוב חוזר' using errcode = '42501'; end if;
  return f_standing_retry_plan(p_id, f_today_il());
end $$;
revoke all on function rpc_standing_retry_preview(uuid) from public, anon;
grant execute on function rpc_standing_retry_preview(uuid) to authenticated;

-- ─────────── (service_role) תוצאת החיוב מ-SUMIT ───────────
create or replace function rpc_standing_retry_charged(p_id uuid, p_sumit_payment_id bigint, p_amount numeric, p_at timestamptz,
                                                     p_valid boolean, p_reason text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_payment uuid; v_after int; v_label text;
begin
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'הוראת הקבע לא נמצאה'); end if;
  if exists (select 1 from standing_order_charges where sumit_payment_id = p_sumit_payment_id) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'valid', p_valid, 'remaining', o.installments - o.charged_count);
  end if;
  v_label := coalesce((select full_name from profiles where id = p_by), 'משתמשת לא מזוהה');
  if p_valid then
    insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
    values (o.student_id, o.branch_id, (coalesce(p_at, now()) at time zone 'Asia/Jerusalem')::date, p_amount, 'credit', 'sumit',
            format('הוראת קבע SUMIT · חיוב חוזר (במקום %s) · חיוב %s מתוך %s',
                   coalesce(to_char(o.next_billing, 'DD/MM'), '—'), o.charged_count + 2, o.installments_total))
    returning id into v_payment;
    v_after := o.installments - (o.charged_count + 1);
    update standing_orders set charged_count = charged_count + 1, retry_uncertain_at = null,
           last_billing = (coalesce(p_at, now()) at time zone 'Asia/Jerusalem')::date,
           needs_renewal = v_after > 0,
           status = case when v_after <= 0 then 'completed' else status end,
           next_billing = case when v_after <= 0 then null else next_billing end,
           last_error = case when v_after > 0 then 'החיוב החוזר עבר; ההוראה ב-SUMIT עוד לא חודשה' end
     where id = o.id;
    insert into standing_order_events (standing_order_id, kind, from_date, to_amount, remaining, actor, actor_label)
    values (o.id, 'retry_charge', o.next_billing, p_amount, v_after, p_by, v_label);
  else
    v_after := o.installments - o.charged_count;
    update standing_orders set failed_count = failed_count + 1, retry_uncertain_at = null,
           last_error = 'ניסיון חוזר נדחה: ' || coalesce(nullif(btrim(p_reason), ''), 'ללא פירוט')
     where id = o.id;
    insert into standing_order_events (standing_order_id, kind, from_date, to_amount, remaining, actor, actor_label, note)
    values (o.id, 'retry_declined', o.next_billing, p_amount, v_after, p_by, v_label, nullif(btrim(p_reason), ''));
  end if;
  insert into standing_order_charges (standing_order_id, sumit_payment_id, amount, charged_at, valid, payment_id)
  values (o.id, p_sumit_payment_id, p_amount, coalesce(p_at, now()), p_valid, v_payment);
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(p_by::text, '?'), 'standing_retry_charge', 'standing_orders', o.id,
          jsonb_build_object('valid', p_valid, 'amount', p_amount, 'sumit_payment_id', p_sumit_payment_id, 'reason', p_reason, 'remaining', v_after));
  return jsonb_build_object('ok', true, 'duplicate', false, 'valid', p_valid, 'remaining', v_after);
end $$;
revoke all on function rpc_standing_retry_charged(uuid, bigint, numeric, timestamptz, boolean, text, uuid) from public, anon, authenticated;
grant execute on function rpc_standing_retry_charged(uuid, bigint, numeric, timestamptz, boolean, text, uuid) to service_role;

-- ─────────── (service_role) ההוראה החדשה ב-SUMIT נוצרה ───────────
create or replace function rpc_standing_retry_renewed(p_id uuid, p_recurring_id bigint, p_next date, p_remaining int, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_day int;
begin
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'הוראת הקבע לא נמצאה'); end if;
  if not o.needs_renewal then return jsonb_build_object('ok', false, 'error', 'אין מה לחדש — לא נרשם חיוב חוזר שעבר'); end if;
  if p_remaining is distinct from o.installments - o.charged_count then
    return jsonb_build_object('ok', false, 'error', format('מספר החיובים שנותרו השתנה (%s, ולא %s)', o.installments - o.charged_count, p_remaining));
  end if;
  v_day := coalesce(o.billing_day, extract(day from o.date_start)::int);
  update standing_orders set sumit_recurring_id = p_recurring_id, status = 'active', sumit_status = null, next_billing = p_next,
         needs_renewal = false, last_error = null, check_failures = 0, last_checked_at = now()
   where id = o.id;
  insert into standing_order_events (standing_order_id, kind, to_date, to_day, remaining, actor, actor_label, note)
  values (o.id, 'renewed', p_next, v_day, p_remaining, p_by, coalesce((select full_name from profiles where id = p_by), 'משתמשת לא מזוהה'),
          format('הוראה חדשה ב-SUMIT (%s) במקום %s שהושבתה', p_recurring_id, o.sumit_recurring_id));
  insert into audit_log (actor, action, table_name, row_id, before, after)
  values ('user:' || coalesce(p_by::text, '?'), 'standing_renewed', 'standing_orders', o.id,
          jsonb_build_object('sumit_recurring_id', o.sumit_recurring_id, 'status', o.status),
          jsonb_build_object('sumit_recurring_id', p_recurring_id, 'next_billing', p_next, 'remaining', p_remaining));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function rpc_standing_retry_renewed(uuid, bigint, date, int, uuid) from public, anon, authenticated;
grant execute on function rpc_standing_retry_renewed(uuid, bigint, date, int, uuid) to service_role;

-- ─────────── (service_role) לא ברור אם חויב ───────────
create or replace function rpc_standing_retry_uncertain(p_id uuid, p_error text, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update standing_orders set retry_uncertain_at = now(),
         last_error = 'ניסיון חוזר: לא ברור אם חויב (' || coalesce(nullif(btrim(p_error), ''), 'ללא פירוט') || ') — לבדוק ב-SUMIT'
   where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'הוראת הקבע לא נמצאה'); end if;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(p_by::text, '?'), 'standing_retry_uncertain', 'standing_orders', p_id, jsonb_build_object('error', p_error));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function rpc_standing_retry_uncertain(uuid, text, uuid) from public, anon, authenticated;
grant execute on function rpc_standing_retry_uncertain(uuid, text, uuid) to service_role;
