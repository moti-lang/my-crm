-- 0032 — בלי המילה "חוג" כברירת מחדל בטקסטים שהמערכת מייצרת (טופס ההרשמה,
-- הודעות להורה, דף התשלום). סניף עם שם מוגדר — השם מופיע; בלי שם — אין שם בכלל.
--   "תודה שנרשמת ל<שם>!" / "תודה שנרשמת!"  (לא "תודה שנרשמת לחוג!")
-- גם: הודעת קישור התשלום הידני הייתה עם "החוג של הניה טייכטל" קבוע לכל הסניפים —
-- עכשיו שם החוג של הסניף, אם יש.
-- טקסטים שהמשתמשת כתבה (תקנון, נוסח הסכמת צילום) לא משתנים כאן.

CREATE OR REPLACE FUNCTION public.rpc_enroll(p jsonb, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_first text := left(trim(p ->> 'first_name'), 60);
  v_last  text := left(trim(p ->> 'last_name'), 60);
  v_grade text := left(trim(p ->> 'grade'), 20);
  v_school text := left(trim(p ->> 'school'), 80);
  v_phone text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_email text := lower(left(trim(p ->> 'email'), 120));
  v_consent boolean := (p ->> 'mailing_consent')::boolean;
  v_terms boolean := (p ->> 'terms_accepted')::boolean;
  v_wa boolean; v_photo boolean; v_track jsonb; v_tracks jsonb; v_opts jsonb;
  v_branch uuid; b branches%rowtype; v_state jsonb;
  v_plan jsonb; v_season uuid; v_student uuid; v_base text; v_token text; v_url text; v_amount numeric;
  v_n_phone int; v_n_ip int; v_program text; v_group text;
begin
  if v_phone ~ '^0\d{9}$' then v_phone := '972' || substr(v_phone, 2); end if;
  select count(*) into v_n_phone from enrollment_requests where phone = v_phone and created_at > now() - interval '1 hour';
  select count(*) into v_n_ip from enrollment_requests where p_ip is not null and ip = p_ip and created_at > now() - interval '1 hour';
  if (select count(*) from enrollment_requests where created_at > now() - interval '1 hour') >= 40 then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'rate_limit_global');
    return jsonb_build_object('ok', false, 'error', 'ההרשמה עמוסה כרגע. נסי שוב בעוד שעה.');
  end if;
  if v_n_phone >= 3 or (p_ip is not null and p_ip <> '' and v_n_ip >= 10) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'rate_limit');
    if v_n_ip = 10 or v_n_phone = 3 then
      insert into system_alerts (kind, severity, title, body, meta)
      values ('enrollment_flood', 'warning', 'הצפת הרשמות מדף ההרשמה', format('%s ניסיונות בשעה מאותו מקור (%s). ייתכן ניסיון אוטומטי.', greatest(v_n_phone, v_n_ip), coalesce(p_ip, v_phone)), jsonb_build_object('ip', p_ip, 'phone', v_phone));
    end if;
    return jsonb_build_object('ok', false, 'error', 'יותר מדי ניסיונות. נסי שוב בעוד שעה.');
  end if;

  if v_first is null or v_first = '' or v_last is null or v_last = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא שם פרטי ושם משפחה'); end if;
  if v_first !~ '^[֐-׿A-Za-z''"\-\s]+$' or v_last !~ '^[֐-׿A-Za-z''"\-\s]+$' then return jsonb_build_object('ok', false, 'error', 'השם יכול להכיל אותיות בלבד'); end if;
  if v_grade is null or v_grade = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא כיתה'); end if;
  if v_school is null or v_school = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא בית ספר'); end if;
  if v_phone !~ '^9725\d{8}$' then return jsonb_build_object('ok', false, 'error', 'מספר הטלפון אינו נייד ישראלי תקין'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'כתובת המייל אינה תקינה'); end if;
  if v_terms is distinct from true then return jsonb_build_object('ok', false, 'error', 'יש לאשר את התקנון'); end if;

  v_branch := f_enroll_branch(p ->> 'enroll_token');
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'הקישור להרשמה אינו תקין'); end if;
  select * into b from branches where id = v_branch for update;
  v_opts := '{"ask_whatsapp": true, "ask_photo": true, "ask_track": true}'::jsonb || coalesce(b.form_options, '{}');

  -- ★ השאלות: חובה כשמוצגות. תשובה שלא נשאלה — לא נלקחת מהבקשה.
  if (v_opts ->> 'ask_whatsapp')::boolean then
    if p ->> 'whatsapp' not in ('yes', 'no') or p ->> 'whatsapp' is null then return jsonb_build_object('ok', false, 'error', 'יש לענות אם אתם מקבלים הודעות וואטסאפ'); end if;
    v_wa := (p ->> 'whatsapp') = 'yes';
  end if;
  if (v_opts ->> 'ask_photo')::boolean then
    if p ->> 'photo' not in ('yes', 'no') or p ->> 'photo' is null then return jsonb_build_object('ok', false, 'error', 'יש לענות על אישור הצילום'); end if;
    v_photo := (p ->> 'photo') = 'yes';
  end if;
  v_program := nullif(trim(coalesce(b.program_name, '')), '');
  v_tracks := case when b.collect_payments then f_visible_tracks(b.plan) else '[]'::jsonb end;
  if not b.collect_payments then
    v_track := null;   -- ★ תשלום חיצוני (מתנ"ס וכד'): אין מסלול, אין סכום, אין קישור
  elsif (v_opts ->> 'ask_track')::boolean then
    select t into v_track from jsonb_array_elements(v_tracks) t where t ->> 'key' = p ->> 'track';
    if v_track is null then return jsonb_build_object('ok', false, 'error', 'יש לבחור אופן תשלום'); end if;
  else
    -- לא נשאלה: המסלול הראשון שמוצג (בלי הוראות קבע לפני סבב 3).
    v_track := v_tracks -> 0;
    if v_track is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;
  end if;

  v_state := f_branch_enrollment_state(v_branch);
  if not (v_state ->> 'open')::boolean then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'branch_' || coalesce(v_state ->> 'reason', 'closed'));
    return jsonb_build_object('ok', false, 'error', case v_state ->> 'reason'
      when 'full' then format('ההרשמה ל%s מלאה. אפשר לפנות אלינו לרשימת המתנה.', b.name)
      else format('ההרשמה ל%s סגורה כרגע.', b.name) end);
  end if;

  v_plan := case when b.collect_payments then f_plan_check(b.plan) end;
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;

  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(trim(v_first || ' ' || v_last))) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'duplicate');
    return jsonb_build_object('ok', false, 'error', format('%s %s כבר רשומה ב%s. לפרטים אפשר לפנות אלינו.', v_first, v_last, b.name));
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_accepted_at, terms_text, plan_snapshot, payment_track, whatsapp_opt_in,
                        photo_consent, photo_consent_text, mailing_consent, trial_started_on, enrolled_at, joined_on, external_payment)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last, v_grade, v_school, v_phone, v_email,
          case when b.collect_payments then 'pending' else 'active' end::student_status, 'enrollment',
          coalesce((v_plan ->> 'tuition')::numeric, 0), coalesce((v_plan ->> 'registration_fee')::numeric, 0),
          (v_track ->> 'installments')::int, (v_track ->> 'installments')::int,
          now(), f_render_program(b.terms, b.program_name), v_plan, v_track, v_wa,
          coalesce(v_photo, false), case when v_photo is not null then b.photo_consent_text end,
          coalesce(v_consent, false), current_date, now(), current_date, not b.collect_payments)
  returning id into v_student;

  v_amount := (v_track ->> 'first_charge')::numeric;
  v_group := case when b.whatsapp_group_url is not null then E'\nקבוצת הוואטסאפ של ' || b.name || ': ' || b.whatsapp_group_url else '' end;
  if b.collect_payments and v_track ->> 'method' <> 'cash' then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
    values (v_token, 'tl-' || gen_random_uuid(), v_student, v_branch, v_amount, 'enrollment');
    select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
    v_url := coalesce(v_base, '') || '/pay/' || v_token;
    -- ההודעה נכנסת לתור בכל מקרה; מי שענתה "לא" לוואטסאפ — הטריגר על reminders מבטל ומסמן.
    insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
    values ('payment_link', v_student, v_branch, v_phone, v_first || ' ' || v_last,
            format(E'תודה שנרשמת%s! כדי להשלים את ההרשמה של %s (%s) — קישור לתשלום, %s ₪: %s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏%s',
                   coalesce(' ל' || v_program, ''), v_first, b.name, to_char(v_amount, 'FM999,999,990'), v_url, v_group),
            now(), 'payment_link:enroll:' || v_student);
  else
    -- בלי קישור תשלום (מזומן / תשלום חיצוני): הודעת ברוכה הבאה, עם קישור הקבוצה אם יש.
    insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
    values ('general', v_student, v_branch, v_phone, v_first || ' ' || v_last,
            format(E'תודה שנרשמת%s! %s רשומה ל%s.%s',
                   coalesce(' ל' || v_program, ''), v_first, b.name,
                   case when v_track ->> 'method' = 'cash' then E'\nהתשלום במזומן מתקבל בסניף.' else '' end || v_group),
            now(), 'welcome:enroll:' || v_student);
  end if;

  insert into enrollment_requests (phone, ip, ok) values (v_phone, p_ip, true);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('enrollment', 'insert', 'students', v_student, jsonb_build_object('branch', b.name, 'terms_accepted_at', now(), 'track', v_track ->> 'key'), 'enrollment');
  return jsonb_build_object('ok', true, 'pay_url', v_url,
                            'amount', case when not b.collect_payments then null when v_track ->> 'method' = 'cash' then (v_plan ->> 'annual_total')::numeric else v_amount end,
                            'method', case when b.collect_payments then v_track ->> 'method' else 'external' end, 'track', v_track ->> 'label',
                            'student', v_first, 'branch', b.name, 'program_name', v_program, 'whatsapp_group_url', b.whatsapp_group_url);
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_create_payment_link(p_student uuid, p_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  select balance into v_balance from v_student_balance where student_id = p_student;
  v_amount := coalesce(p_amount, v_balance);
  if v_amount is null or v_amount <= 0 then raise exception 'אין חוב פתוח לתלמידה הזו'; end if;
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

  return jsonb_build_object('id', v_id, 'token', v_token, 'url', v_url, 'amount', v_amount, 'expires_at', now() + interval '7 days');
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_payment_link_public(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare l payment_links%rowtype; v_name text; v_branch text;
begin
  select * into l from payment_links where token = p_token;
  if l.id is null then return jsonb_build_object('ok', false, 'error', 'הקישור לא נמצא'); end if;
  select split_part(full_name, ' ', 1) into v_name from students where id = l.student_id;
  select name into v_branch from branches where id = l.branch_id;
  if l.status in ('paid', 'mismatch') then
    return jsonb_build_object('ok', true, 'state', 'paid', 'student', v_name, 'branch', v_branch, 'amount', l.amount, 'paid_at', l.paid_at);
  end if;
  if not f_payment_link_alive(l) then
    return jsonb_build_object('ok', false, 'state', 'expired', 'error', 'הקישור פג תוקף או בוטל. אפשר לבקש קישור חדש.');
  end if;
  if l.status = 'pending' then update payment_links set status = 'opened', opened_at = now() where id = l.id; end if;
  return jsonb_build_object('ok', true, 'state', 'open', 'student', v_name, 'branch', v_branch, 'amount', l.amount,
                            'expires_at', l.expires_at, 'sumit_page_url', l.sumit_page_url,
                            -- הוראת קבע: הנוסח והתאריכים. אחרי שאושר — מה שאושר.
                            'standing', case when l.standing_consented_at is not null
                                             then jsonb_build_object('text', l.standing_consent_text, 'consented', true)
                                             else f_standing_consent(l.id) end);
end $function$;
