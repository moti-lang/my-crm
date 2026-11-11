-- 0051 — ביטול הרשמה חריג לתקנון (הבעלים): גם אחרי חודש הניסיון, עם סכום החזר לפי החלטתה.
--
-- המקרה (שוהם רות גוליאן, 11/11): חודש הניסיון הסתיים, ולפי התקנון אין ביטול — הכפתור אפור. הניה
-- רוצה לבטל בכל זאת. עכשיו:
--  · סיבה חובה; נרשם ביומן כ"חריג לתקנון".
--  · סכום החזר — 0 עד מה ששולם (הבעלים מחליטה). שורת החזר (סכום שלילי, source refund). את הכסף עצמו
--    מחזירים ב-SUMIT — המסך מזכיר.
--  · "הפסיקה", קישורים פתוחים ותזכורות מתוזמנות מתבטלים; יוצאת מרשימות החוב (רק פעילות/ממתינות שם).
--  · ★ הוראת קבע פעילה ב-SUMIT — קודם עוצרים אותה (אחרת ממשיכה לחייב אחרי הביטול).

create or replace function rpc_cancel_enrollment_override(p_student uuid, p_refund numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_refund numeric := round(coalesce(p_refund, 0), 2);
        v_paid numeric; v_method payment_method; v_links int; v_reminders int; v_sumit boolean;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לבטל הרשמה' using errcode = '42501'; end if;
  if v_reason is null then raise exception 'יש לכתוב סיבה לביטול החריג'; end if;
  select * into s from students where id = p_student and deleted_at is null for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if s.cancelled_at is not null then raise exception 'ההרשמה כבר בוטלה'; end if;
  if exists (select 1 from standing_orders o where o.student_id = s.id and o.status in ('active', 'retrying', 'failed')) then
    raise exception 'לתלמידה יש הוראת קבע ב-SUMIT — קודם לעצור אותה ("עצירת הוראת קבע" בכרטיס), ואז לבטל את ההרשמה. אחרת היא תמשיך לחייב.';
  end if;
  select coalesce(sum(amount), 0) into v_paid from payments where student_id = s.id and deleted_at is null;
  if v_refund < 0 then raise exception 'סכום ההחזר לא יכול להיות שלילי'; end if;
  if v_refund > v_paid then raise exception 'סכום ההחזר (%) גדול ממה ששולם (%)', trim_scale(v_refund), trim_scale(v_paid); end if;

  update students set status = 'stopped', stopped_on = f_today_il(), stop_reason = 'ביטול הרשמה (חריג לתקנון): ' || v_reason,
         cancelled_at = now(), refund_amount = v_refund
   where id = s.id;
  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  get diagnostics v_links = row_count;
  update reminders set status = 'cancelled', error = 'ההרשמה בוטלה' where student_id = s.id and status = 'scheduled';
  get diagnostics v_reminders = row_count;
  if v_refund > 0 then
    -- אותו אמצעי תשלום כמו התשלום האחרון (כרטיס → זיכוי בכרטיס).
    select method into v_method from payments where student_id = s.id and deleted_at is null and amount > 0 order by paid_on desc, created_at desc limit 1;
    insert into payments (student_id, branch_id, paid_on, amount, method, source, note, void_reason, voided_by, collected_by)
    values (s.id, s.branch_id, f_today_il(), -v_refund, coalesce(v_method, 'other'), 'refund',
            'החזר — ביטול הרשמה (חריג לתקנון): ' || v_reason, v_reason, auth.uid(), auth.uid());
  end if;
  v_sumit := exists (select 1 from payments where student_id = s.id and deleted_at is null and source = 'sumit' and amount > 0);
  insert into audit_log (actor, action, table_name, row_id, after)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'cancel_enrollment', 'students', s.id,
          jsonb_build_object('override', true, 'reason', v_reason, 'refund', v_refund, 'paid_before', v_paid,
                             'cancelled_links', v_links, 'cancelled_reminders', v_reminders));
  return jsonb_build_object('ok', true, 'refund', v_refund, 'paid_before', v_paid, 'from_sumit', v_sumit);
end $$;
revoke all on function rpc_cancel_enrollment_override(uuid, numeric, text) from public, anon;
grant execute on function rpc_cancel_enrollment_override(uuid, numeric, text) to authenticated;
