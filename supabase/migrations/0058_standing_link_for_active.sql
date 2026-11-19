-- 0058 — "קישור הרשמה חדש" (הוראת קבע) גם לתלמידה שנוספה ידנית כ"פעילה" ועוד לא שילמה כלום.
--
-- המקרה (אושרת ראובן, 15/11): נוספה ידנית כ"פעילה" במסלול "הוראת קבע באשראי 10 תשלומים". לתלמידה
-- פעילה הכרטיס הציע רק "קישור תשלום" רגיל — ונשלח קישור על כל 1,800 ₪, חיוב אחד בכרטיס. האמא שאלה
-- למה אין בחירת תשלומים ותאריך, כשאחרות (שנרשמו בטופס) כן מקבלות.
--
-- עכשיו "ממתינה לחיוב הראשון" (f_enrollment_unpaid) היא גם:
--   פעילה + מסלול הוראת קבע + לא שולם עליה כלום (סכום התשלומים 0) + אין לה שום הוראת קבע.
-- כמו ממתינה: הכרטיס מציע "קישור הרשמה חדש" — התשלום הראשון לפי המסלול, בחירת יום חיוב, והשאר
-- בהוראת קבע — וקישור תשלום רגיל על כל הסכום נחסם עם הסבר. כל השאר (ממתינה; פעילה שכבר שילמה;
-- מסלול בכרטיס בתשלום אחד; מזומן; תשלום חיצוני) — בדיוק כמו קודם.

create or replace function f_enrollment_unpaid(s students) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select s.cancelled_at is null and s.deleted_at is null
     and not coalesce(s.external_payment, false)
     and s.payment_track is not null and coalesce(s.payment_track ->> 'method', 'cash') <> 'cash'
     and not f_enrollment_link_paid(s.id)
     and not f_first_charge_covered(s)
     and (s.status = 'pending'
          or (s.status = 'active' and s.payment_track ->> 'method' = 'standing_order'
              and (select coalesce(sum(p.amount), 0) from payments p where p.student_id = s.id and p.deleted_at is null) <= 0
              and not exists (select 1 from standing_orders o where o.student_id = s.id)))
$$;
revoke all on function f_enrollment_unpaid(students) from public, anon, authenticated;

-- הודעת השגיאה של "קישור הרשמה חדש" — מעודכנת לכלל החדש (שאר הגוף זהה מילה במילה).
CREATE OR REPLACE FUNCTION public.rpc_renew_enrollment_link(p_student uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s students%rowtype; v_amount numeric; v_token text; v_id uuid; v_base text; v_url text; v_reminder uuid;
  v_branch text; v_program text; v_first text; v_standing boolean; v_n int; v_cancelled int;
begin
  select * into s from students where id = p_student and deleted_at is null;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and s.branch_id in (select my_branches())) then
    raise exception 'אין הרשאה לשלוח קישור תשלום לתלמידה הזו' using errcode = '42501';
  end if;
  if s.parent_phone is null then raise exception 'לתלמידה אין טלפון של הורה — אין למי לשלוח את הקישור'; end if;
  -- ★ הוראת קבע קיימת ב-SUMIT (גם אם התשלום הראשון הוחזר) — קישור חדש היה יוצר הוראה שנייה.
  if exists (select 1 from standing_orders o where o.student_id = s.id and o.status in ('active', 'retrying', 'failed')) then
    raise exception 'לתלמידה יש הוראת קבע ב-SUMIT — קישור הרשמה חדש היה יוצר הוראה שנייה. קודם לעצור את ההוראה הקיימת.';
  end if;
  if f_enrollment_link_paid(s.id) then
    raise exception 'החיוב הראשון בהרשמה כבר שולם — אין צורך בקישור הרשמה חדש';
  end if;
  -- ★ החיוב הראשון כבר מכוסה בתשלום אחר (קישור רגיל / רישום ידני) — קישור נוסף היה מחייב פעמיים.
  if f_first_charge_covered(s) then
    raise exception 'המשפחה כבר שילמה את החיוב הראשון (% ₪ עד עכשיו) — אין צורך בקישור הרשמה חדש',
      (select trim_scale(coalesce(sum(p.amount), 0)) from payments p where p.student_id = s.id and p.deleted_at is null);
  end if;
  if not f_enrollment_unpaid(s) then
    raise exception 'קישור הרשמה חדש — רק לתלמידה שממתינה לחיוב הראשון בכרטיס: ממתינה (לא במזומן), או פעילה במסלול הוראת קבע שעוד לא שילמה כלום';
  end if;
  v_amount := (s.payment_track ->> 'first_charge')::numeric;
  if v_amount is null or v_amount <= 0 then raise exception 'במסלול של התלמידה אין חיוב ראשון בכרטיס'; end if;
  v_n := coalesce((s.payment_track ->> 'installments')::int, 1);
  v_standing := s.payment_track ->> 'method' = 'standing_order' and v_n >= 2;

  -- קישור אחד חי בכל רגע (כמו בקישור תשלום): הפתוח הקודם — של ההרשמה או חוב — מתבטל.
  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  get diagnostics v_cancelled = row_count;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id := gen_random_uuid();
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, created_by)
  values (v_id, v_token, 'tl-' || v_id, s.id, s.branch_id, v_amount, 'enrollment', auth.uid());

  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  select name, nullif(trim(coalesce(program_name, '')), '') into v_branch, v_program from branches where id = s.branch_id;
  v_first := split_part(s.full_name, ' ', 1);

  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, created_by, dedupe_key)
  values ('payment_link', s.id, s.branch_id, s.parent_phone, coalesce(s.parent_name, '') || ' · ' || s.full_name,
          format(E'שלום %s, זה קישור חדש להשלמת ההרשמה של %s%s (%s): %s\nהתשלום הראשון: %s ₪.%s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 coalesce(s.parent_name, ''), v_first, coalesce(' — ' || v_program, ''), v_branch, v_url, to_char(v_amount, 'FM999,999,990'),
                 case when v_standing then format(' בדף בוחרים את יום החיוב בחודש ומאשרים את הוראת הקבע (עוד %s תשלומים).', v_n - 1) else '' end),
          now(), auth.uid(), 'payment_link:' || v_id)
  returning id into v_reminder;
  update payment_links set reminder_id = v_reminder where id = v_id;

  insert into audit_log (actor, action, table_name, row_id, after, source)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'renew_enrollment_link', 'students', s.id,
          jsonb_build_object('link', v_id, 'amount', v_amount, 'track', s.payment_track ->> 'key', 'cancelled_links', v_cancelled), 'ui');

  return jsonb_build_object('id', v_id, 'token', v_token, 'url', v_url, 'amount', v_amount, 'expires_at', now() + interval '7 days',
                            'standing', v_standing, 'track', s.payment_track ->> 'label', 'cancelled', v_cancelled,
                            'whatsapp', f_link_whatsapp_state(v_reminder));
end $function$;
