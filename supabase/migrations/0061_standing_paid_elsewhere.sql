-- 0061 — הוראת קבע שהושבתה, והחיוב שנכשל שולם בנפרד (למשל חיוב ידני בכרטיס ב-SUMIT): רושמים, ומחדשים בלי לחייב.
--
-- המקרה (שלוש אחיות, 22/11): החיוב של 19/11 נכשל וההוראה הושבתה. החיוב עבר אחר כך בנפרד — לא דרך
-- ההוראה — ולכן ב-SUMIT ההוראה נשארה "חסומה עקב אי תשלום" עם 19/11 פתוח, ואצלנו התשלום לא קיים בכלל.
-- "ניסיון חיוב חוזר" היה מחייב את ההורים פעם שנייה.
--
-- עכשיו (rpc_standing_paid_elsewhere, בעלים): התשלום נרשם (הסכום החודשי של ההוראה, באשראי, עם הערה
-- חובה — איך שולם), "חיוב X מתוך N" מתקדם, ויומן ההוראה. ההוראה מסומנת "צריך לחדש" — והשלב הקיים של
-- ניסיון החיוב החוזר (0048) מחדש אותה ב-SUMIT לחיובים שנותרו, מהחודש הבא, בלי שום חיוב.

alter table standing_order_events drop constraint if exists standing_order_events_kind_check;
alter table standing_order_events add constraint standing_order_events_kind_check
  check (kind in ('reschedule', 'sumit_change', 'amount_change', 'retry_charge', 'retry_declined', 'renewed', 'retry_refused', 'paid_elsewhere'));

-- שם מי שעשתה את הפעולה ביומן ההוראה — מהטריגר (הפונקציה שהדפדפן מריץ לא נוגעת ב-profiles; 15_users_screen_attack).
create or replace function f_standing_event_actor_label() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.actor_label is null then
    new.actor_label := coalesce((select full_name from profiles where id = new.actor), 'משתמשת לא מזוהה');
  end if;
  return new;
end $$;
revoke all on function f_standing_event_actor_label() from public, anon, authenticated;
drop trigger if exists standing_order_events_actor_label on standing_order_events;
create trigger standing_order_events_actor_label before insert on standing_order_events
  for each row execute function f_standing_event_actor_label();

create or replace function rpc_standing_paid_elsewhere(p_id uuid, p_paid_on date, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o standing_orders%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_after int; v_payment uuid;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לרשום חיוב ששולם בנפרד' using errcode = '42501'; end if;
  if v_note is null then raise exception 'יש לכתוב איך שולם (למשל: חיוב ידני בכרטיס ב-SUMIT, מספר קבלה)'; end if;
  select * into o from standing_orders where id = p_id for update;
  if o.id is null then raise exception 'הוראת הקבע לא נמצאה'; end if;
  if o.status <> 'failed' or o.needs_renewal then
    raise exception 'רק בהוראה שהושבתה אחרי חיוב שנכשל, ושעוד לא נרשם לה חיוב חוזר';
  end if;
  if o.retry_uncertain_at > now() - interval '24 hours' then
    raise exception 'בניסיון החיוב החוזר האחרון לא ברור אם חויב — לבדוק ב-SUMIT קודם';
  end if;
  if p_paid_on is null or p_paid_on > f_today_il() or p_paid_on < coalesce(o.next_billing, f_today_il()) - 7 then
    raise exception 'תאריך התשלום: מהחיוב שנכשל (%) ועד היום', to_char(o.next_billing, 'DD/MM');
  end if;
  v_after := o.installments - (o.charged_count + 1);
  if v_after < 0 then raise exception 'כל החיובים בהוראה כבר בוצעו'; end if;

  insert into payments (student_id, branch_id, paid_on, amount, method, source, note, collected_by)
  values (o.student_id, o.branch_id, p_paid_on, o.amount, 'credit', 'manual',
          format('הוראת קבע · החיוב של %s שולם בנפרד · חיוב %s מתוך %s · %s',
                 coalesce(to_char(o.next_billing, 'DD/MM'), '—'), o.charged_count + 2, o.installments_total, v_note), auth.uid())
  returning id into v_payment;
  update standing_orders set charged_count = charged_count + 1, last_billing = p_paid_on, retry_uncertain_at = null,
         needs_renewal = v_after > 0,
         status = case when v_after <= 0 then 'completed' else status end,
         next_billing = case when v_after <= 0 then null else next_billing end,
         last_error = case when v_after > 0 then 'החיוב שנכשל שולם בנפרד; ההוראה ב-SUMIT עוד לא חודשה' end
   where id = o.id;
  insert into standing_order_events (standing_order_id, kind, from_date, to_amount, remaining, actor, note)
  values (o.id, 'paid_elsewhere', o.next_billing, o.amount, v_after, auth.uid(), v_note);
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || auth.uid()::text, 'standing_paid_elsewhere', 'standing_orders', o.id,
          jsonb_build_object('amount', o.amount, 'paid_on', p_paid_on, 'note', v_note, 'payment', v_payment, 'remaining', v_after));
  return jsonb_build_object('ok', true, 'amount', o.amount, 'remaining', v_after, 'needs_renewal', v_after > 0, 'payment', v_payment);
end $$;
revoke all on function rpc_standing_paid_elsewhere(uuid, date, text) from public, anon;
grant execute on function rpc_standing_paid_elsewhere(uuid, date, text) to authenticated;

-- התוכנית בשלב החידוש: גם אחרי "שולם בנפרד", לא רק אחרי חיוב חוזר (שאר הגוף זהה מילה במילה).
CREATE OR REPLACE FUNCTION public.f_standing_retry_plan(p_id uuid, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_lines := array['החיוב שנכשל כבר שולם ונרשם (בחיוב חוזר, או בנפרד). נשאר לחדש את ההוראה ב-SUMIT — בלי חיוב נוסף.', v_renewal];
  end if;
  return jsonb_build_object('ok', true, 'stage', v_stage, 'amount', o.amount, 'missed', o.next_billing, 'remaining_after', v_after,
                            'next', v_next, 'final', v_final, 'day', v_day, 'lines', to_jsonb(v_lines));
end $function$;
