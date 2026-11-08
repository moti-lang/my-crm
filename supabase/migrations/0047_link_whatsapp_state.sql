-- 0047 — קישור תשלום: המסך אומר את האמת על הוואטסאפ.
--
-- עד עכשיו, אחרי יצירת קישור (תשלום / הרשמה חדש) המסך כתב "נשלח". בפועל ההודעה נכנסת לתור
-- התזכורות, ויוצאת רק כשיש משימה מתוזמנת ששולחת את התור (cron-reminders) — ואין כזו: שליחת
-- הוואטסאפ מהמערכת עדיין לא הופעלה. ולהורה שסימנה "לא מקבלת וואטסאפ" ההודעה מבוטלת מיד.
--
-- עכשיו שני הקישורים מחזירים whatsapp:
--   'queued'    — ההודעה בתור, ויש משימה פעילה ששולחת אותו;
--   'off'       — ההודעה בתור, אבל שליחת וואטסאפ מהמערכת לא פעילה (אין משימה) — לא תצא;
--   'opted_out' — ההורה לא מקבלת וואטסאפ; ההודעה בוטלה.
-- המסך מציג את המצב, ו"העתקת קישור" לשליחה ב-SMS / בוואטסאפ אישי.

-- ★ האם יש משימה פעילה ששולחת את תור התזכורות. pg_cron קיים בענן; בלעדיו (סביבת בדיקה) — לא.
create or replace function f_wa_sending_active() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v boolean := false;
begin
  if to_regclass('cron.job') is null then return false; end if;
  execute $q$select exists (select 1 from cron.job where active and command like '%/functions/v1/cron-reminders%')$q$ into v;
  return coalesce(v, false);
end $$;
revoke all on function f_wa_sending_active() from public, anon, authenticated;

-- מצב ההודעה של קישור, לפי התזכורת שנוצרה איתו.
create or replace function f_link_whatsapp_state(p_reminder uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when (select status from reminders where id = p_reminder) = 'cancelled' then 'opted_out'
    when not f_wa_sending_active() then 'off'
    else 'queued' end
$$;
revoke all on function f_link_whatsapp_state(uuid) from public, anon, authenticated;

-- ─── קישור תשלום (חוב): כמו ב-0046, ומחזיר את מצב הוואטסאפ ───
create or replace function rpc_create_payment_link(p_student uuid, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students%rowtype; v_balance numeric; v_amount numeric; v_token text; v_id uuid;
  v_base text; v_url text; v_reminder uuid; v_branch_name text; v_program text; v_first text;
begin
  select * into v_student from students where id = p_student and deleted_at is null;
  if v_student.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and v_student.branch_id in (select my_branches())) then
    raise exception 'אין הרשאה לשלוח קישור תשלום לתלמידה הזו' using errcode = '42501';
  end if;
  if v_student.parent_phone is null then
    raise exception 'לתלמידה אין טלפון של הורה — אין למי לשלוח את הקישור';
  end if;
  -- ★ ממתינה לחיוב הראשון בכרטיס: קישור חוב לא משלים את ההרשמה ולא יוצר הוראת קבע.
  if f_enrollment_unpaid(v_student) then
    raise exception 'התלמידה ממתינה לחיוב הראשון של ההרשמה — לשלוח "קישור הרשמה חדש". בקישור תשלום רגיל ההרשמה לא מושלמת והוראת הקבע לא נוצרת.';
  end if;
  select balance into v_balance from v_student_balance where student_id = p_student;
  v_amount := round(coalesce(p_amount, v_balance), 2);
  if v_amount is null or v_balance is null or v_balance <= 0 then raise exception 'אין חוב פתוח לתלמידה הזו'; end if;
  if v_amount < 1 then raise exception 'הסכום בקישור: לפחות 1 ₪'; end if;
  if v_amount > v_balance then raise exception 'הסכום (%) גדול מהחוב הפתוח (%)', v_amount, v_balance; end if;

  -- קישור פתוח קודם לאותה תלמידה מתבטל: קישור אחד חי בכל רגע.
  update payment_links set status = 'cancelled' where student_id = p_student and status in ('pending', 'opened');

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id := gen_random_uuid();
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, created_by)
  values (v_id, v_token, 'tl-' || v_id, p_student, v_student.branch_id, v_amount, auth.uid());

  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  select name, nullif(trim(coalesce(program_name, '')), '') into v_branch_name, v_program from branches where id = v_student.branch_id;
  v_first := split_part(v_student.full_name, ' ', 1);

  -- ההודעה יוצאת דרך תור התזכורות (cron-reminders → wa-send), כמו כל הודעה אחרת.
  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, created_by, dedupe_key)
  values ('payment_link', p_student, v_student.branch_id, v_student.parent_phone,
          coalesce(v_student.parent_name, '') || ' · ' || v_student.full_name,
          format(E'שלום %s, זה קישור לתשלום עבור %s%s (%s): %s\nהסכום: %s ₪. הקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 coalesce(v_student.parent_name, ''), v_first, coalesce(' — ' || v_program, ''), v_branch_name, v_url, to_char(v_amount, 'FM999,999,990.00')),
          now(), auth.uid(), 'payment_link:' || v_id)
  returning id into v_reminder;
  update payment_links set reminder_id = v_reminder where id = v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'url', v_url, 'amount', v_amount, 'expires_at', now() + interval '7 days',
                            'whatsapp', f_link_whatsapp_state(v_reminder));
end $$;
revoke all on function rpc_create_payment_link(uuid, numeric) from public, anon;
grant execute on function rpc_create_payment_link(uuid, numeric) to authenticated;

-- ─── קישור הרשמה חדש: כמו ב-0046, ומחזיר את מצב הוואטסאפ ───
create or replace function rpc_renew_enrollment_link(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
  if exists (select 1 from payment_links l where l.student_id = s.id and l.purpose = 'enrollment' and l.status in ('paid', 'mismatch')) then
    raise exception 'החיוב הראשון בהרשמה כבר שולם — אין צורך בקישור הרשמה חדש';
  end if;
  if not f_enrollment_unpaid(s) then
    raise exception 'קישור הרשמה חדש — רק לתלמידה שממתינה לחיוב הראשון בכרטיס (לא במזומן ולא תלמידה פעילה)';
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
end $$;
revoke all on function rpc_renew_enrollment_link(uuid) from public, anon;
grant execute on function rpc_renew_enrollment_link(uuid) to authenticated;
