-- 0030 — סניף בלי גבייה, קישור לקבוצת וואטסאפ, שם החוג לפי סניף.
--
-- collect_payments = false (התשלום דרך המתנ"ס וכד'):
--   · דף ההרשמה בלי שאלת תשלום ובלי סכומים; מבנה התשלום לא נבדק לסניף.
--   · אין קישור תשלום — לא בהרשמה ולא ידני (טריגר על payment_links).
--   · התלמידה פעילה מיד, בלי סכום לגבייה (שכר לימוד 0) → לא חייבת, בלי תזכורות חוב.
--   · מסומנת students.external_payment → תג "תשלום חיצוני".
-- whatsapp_group_url: קישור chat.whatsapp.com, מוצג לחיץ בסיום ההרשמה ונשלח בהודעה.
-- program_name: שם החוג של הסניף. ריק = לא מוצג שם (במשפטים: "חוג").
--   בתקנון: {שם החוג} מוחלף בשם; ריק → השורה יורדת.

alter table branches
  add column if not exists collect_payments boolean not null default true,
  add column if not exists program_name text,
  add column if not exists whatsapp_group_url text;
alter table branches drop constraint if exists branches_whatsapp_group_url_check;
alter table students add column if not exists external_payment boolean not null default false;

-- קישור לקבוצה שהוקלד בתוך התקנון (לפני שהיה שדה) — עובר לשדה.
update branches set whatsapp_group_url = substring(terms from 'https://chat\.whatsapp\.com/[A-Za-z0-9]+')
 where whatsapp_group_url is null and terms ~ 'https://chat\.whatsapp\.com/[A-Za-z0-9]+';
alter table branches add constraint branches_whatsapp_group_url_check
  check (whatsapp_group_url is null or whatsapp_group_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]+/?$');

-- שם החוג: רק "דרך אמונה - בית שמש" מקבלת את השם הנוכחי. שאר הסניפים ריקים.
update branches set program_name = (select value #>> '{}' from settings where key = 'program_name')
 where name = 'דרך אמונה - בית שמש' and deleted_at is null and program_name is null;
-- בתקנון של שאר הסניפים ובברירת המחדל: השורה עם השם → {שם החוג}.
update branches set terms = replace(terms, 'חוגי דרמחול - החוגים של הניה', '{שם החוג}')
 where name <> 'דרך אמונה - בית שמש' and terms like '%חוגי דרמחול - החוגים של הניה%';
update settings set value = to_jsonb(replace(value #>> '{}', 'חוגי דרמחול - החוגים של הניה', '{שם החוג}'))
 where key = 'enrollment_terms';

create or replace function f_render_program(p_text text, p_program text) returns text
language sql immutable as $$
  select case when nullif(trim(coalesce(p_program, '')), '') is null
              then regexp_replace(coalesce(p_text, ''), '\{שם החוג\}\n?', '', 'g')
              else replace(coalesce(p_text, ''), '{שם החוג}', trim(p_program)) end
$$;
revoke all on function f_render_program(text, text) from public, anon, authenticated;

-- מבנה התשלום נבדק רק בסניף שגובה.
create or replace function f_branch_defaults() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.plan is null then new.plan := (select value from settings where key = 'enrollment_plan'); end if;
  if new.terms is null then new.terms := (select value #>> '{}' from settings where key = 'enrollment_terms'); end if;
  if new.photo_consent_text is null then new.photo_consent_text := (select value #>> '{}' from settings where key = 'photo_consent_text'); end if;
  if new.plan is not null and new.collect_payments then perform f_plan_check(new.plan); end if;
  return new;
end $$;
drop trigger if exists branches_defaults on branches;
create trigger branches_defaults before insert or update of plan, terms, photo_consent_text, collect_payments on branches
  for each row execute function f_branch_defaults();

-- ★ אין קישור תשלום לתלמידה בתשלום חיצוני — מכל מסלול (הרשמה, כפתור, פקודה).
create or replace function f_no_link_for_external() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from students where id = new.student_id and external_payment) then
    raise exception 'התשלום של התלמידה הזו נגבה מחוץ למערכת (תשלום חיצוני) — אין קישור תשלום';
  end if;
  return new;
end $$;
revoke all on function f_no_link_for_external() from public, anon, authenticated;
drop trigger if exists payment_links_no_external on payment_links;
create trigger payment_links_no_external before insert on payment_links
  for each row execute function f_no_link_for_external();

-- ★ ולא תזכורות חוב (גם אם יוזן סכום ידנית בעתיד).
create or replace function f_no_debt_reminder_external() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'debt' and new.status = 'scheduled'
     and exists (select 1 from students where id = new.student_id and external_payment) then
    new.status := 'cancelled';
    new.error := 'תשלום חיצוני — לא שולחים תזכורת חוב';
  end if;
  return new;
end $$;
revoke all on function f_no_debt_reminder_external() from public, anon, authenticated;
drop trigger if exists reminders_no_debt_external on reminders;
create trigger reminders_no_debt_external before insert on reminders
  for each row execute function f_no_debt_reminder_external();

-- /pay: שם החוג של הסניף (ריק → לא מוצג).
create or replace function rpc_payment_link_program(p_token text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(trim(coalesce(b.program_name, '')), '') from payment_links l join branches b on b.id = l.branch_id where l.token = p_token
$$;
revoke all on function rpc_payment_link_program(text) from public;
grant execute on function rpc_payment_link_program(text) to anon, authenticated, service_role;

create or replace function rpc_enrollment_public(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_branch uuid; b branches%rowtype; v_state jsonb; v_opts jsonb;
begin
  v_branch := f_enroll_branch(p_token);
  if v_branch is null then
    return jsonb_build_object('ok', false,
      'error', case when coalesce(p_token, '') = '' then 'להרשמה יש להיכנס דרך הקישור של הסניף' else 'הקישור להרשמה אינו תקין' end);
  end if;
  select * into b from branches where id = v_branch;
  v_state := f_branch_enrollment_state(v_branch);
  v_opts := '{"ask_whatsapp": true, "ask_photo": true, "ask_track": true}'::jsonb || coalesce(b.form_options, '{}');
  return jsonb_build_object(
    'ok', true,
    'program_name', nullif(trim(coalesce(b.program_name, '')), ''),
    'collect_payments', b.collect_payments,
    'whatsapp_group_url', b.whatsapp_group_url,
    'branch', jsonb_build_object('name', b.name, 'city', b.city, 'schedule', b.schedule_text, 'age_groups', b.age_groups),
    'terms', f_render_program(b.terms, b.program_name),
    'plan', case when b.collect_payments then f_plan_check(b.plan) - 'tracks' end,
    'tracks', case when b.collect_payments then f_visible_tracks(b.plan) else '[]'::jsonb end,
    'questions', jsonb_build_object(
      'whatsapp', (v_opts ->> 'ask_whatsapp')::boolean,
      'photo', (v_opts ->> 'ask_photo')::boolean,
      'track', (v_opts ->> 'ask_track')::boolean and b.collect_payments),
    'photo_consent_text', case when (v_opts ->> 'ask_photo')::boolean then b.photo_consent_text end,
    'open', (v_state ->> 'open')::boolean,
    'closed_reason', v_state ->> 'reason');
end $$;

create or replace function rpc_enroll(p jsonb, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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
      when 'full' then format('ההרשמה ל%s מלאה. אפשר לפנות לחוג לרשימת המתנה.', b.name)
      else format('ההרשמה ל%s סגורה כרגע.', b.name) end);
  end if;

  v_plan := case when b.collect_payments then f_plan_check(b.plan) end;
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;

  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(trim(v_first || ' ' || v_last))) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'duplicate');
    return jsonb_build_object('ok', false, 'error', format('%s %s כבר רשומה ב%s. לפרטים אפשר לפנות לחוג.', v_first, v_last, b.name));
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
            format(E'תודה שנרשמת ל%s! כדי להשלים את ההרשמה של %s (%s) — קישור לתשלום, %s ₪: %s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏%s',
                   coalesce(v_program, 'חוג'), v_first, b.name, to_char(v_amount, 'FM999,999,990'), v_url, v_group),
            now(), 'payment_link:enroll:' || v_student);
  else
    -- בלי קישור תשלום (מזומן / תשלום חיצוני): הודעת ברוכה הבאה, עם קישור הקבוצה אם יש.
    insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
    values ('general', v_student, v_branch, v_phone, v_first || ' ' || v_last,
            format(E'תודה שנרשמת ל%s! %s רשומה ל%s.%s',
                   coalesce(v_program, 'חוג'), v_first, b.name,
                   case when v_track ->> 'method' = 'cash' then E'\nהתשלום במזומן מתקבל בחוג.' else '' end || v_group),
            now(), 'welcome:enroll:' || v_student);
  end if;

  insert into enrollment_requests (phone, ip, ok) values (v_phone, p_ip, true);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('enrollment', 'insert', 'students', v_student, jsonb_build_object('branch', b.name, 'terms_accepted_at', now(), 'track', v_track ->> 'key'), 'enrollment');
  return jsonb_build_object('ok', true, 'pay_url', v_url,
                            'amount', case when not b.collect_payments then null when v_track ->> 'method' = 'cash' then (v_plan ->> 'annual_total')::numeric else v_amount end,
                            'method', case when b.collect_payments then v_track ->> 'method' else 'external' end, 'track', v_track ->> 'label',
                            'student', v_first, 'branch', b.name, 'program_name', v_program, 'whatsapp_group_url', b.whatsapp_group_url);
end $$;

create or replace function rpc_create_student(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid; b branches%rowtype; v_plan jsonb; v_season uuid; v_id uuid; v_track jsonb;
  v_first text := nullif(left(trim(p ->> 'first_name'), 60), '');
  v_last  text := nullif(left(trim(p ->> 'last_name'), 60), '');
  v_phone text := regexp_replace(coalesce(p ->> 'parent_phone', ''), '\D', '', 'g');
  v_email text := nullif(lower(left(trim(p ->> 'email'), 120)), '');
  v_status student_status;
begin
  begin v_branch := (p ->> 'branch_id')::uuid; exception when others then v_branch := null; end;
  select * into b from branches where id = v_branch and deleted_at is null;
  if b.id is null then raise exception 'יש לבחור סניף'; end if;
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and v_branch in (select my_branches())) then
    raise exception 'אין הרשאה להוסיף תלמידה לסניף הזה' using errcode = '42501';
  end if;
  if v_first is null or v_last is null then raise exception 'יש למלא שם פרטי ושם משפחה'; end if;
  if v_phone ~ '^0\d{8,9}$' then v_phone := '972' || substr(v_phone, 2); end if;
  if v_phone <> '' and v_phone !~ '^972\d{8,9}$' then raise exception 'מספר הטלפון אינו תקין'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'כתובת המייל אינה תקינה'; end if;
  v_status := coalesce(nullif(p ->> 'status', ''), 'active')::student_status;
  if v_status not in ('active', 'pending') then raise exception 'תלמידה חדשה נוספת כפעילה או כממתינה'; end if;
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then raise exception 'אין עונה פעילה'; end if;
  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(v_first || ' ' || v_last)) then
    raise exception '% % כבר רשומה ב%', v_first, v_last, b.name;
  end if;
  v_plan := case when b.collect_payments then f_plan_check(b.plan) end;
  if b.collect_payments and nullif(p ->> 'track', '') is not null then
    select t into v_track from jsonb_array_elements(v_plan -> 'tracks') t where t ->> 'key' = p ->> 'track';
    if v_track is null then raise exception 'מסלול התשלום לא קיים בסניף'; end if;
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_name, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_text, plan_snapshot, payment_track, whatsapp_opt_in, photo_consent, mailing_consent, joined_on, notes, external_payment)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last,
          nullif(left(trim(p ->> 'grade'), 20), ''), nullif(left(trim(p ->> 'school'), 80), ''),
          nullif(left(trim(p ->> 'parent_name'), 80), ''), nullif(v_phone, ''), v_email,
          case when b.collect_payments then v_status else 'active' end::student_status, 'manual',
          coalesce((v_plan ->> 'tuition')::numeric, 0), coalesce((v_plan ->> 'registration_fee')::numeric, 0),
          case when b.collect_payments then coalesce((v_track ->> 'installments')::int, 10) end,
          case when b.collect_payments then coalesce((v_track ->> 'installments')::int, 10) end,
          f_render_program(b.terms, b.program_name), v_plan, v_track, (p ->> 'whatsapp_opt_in')::boolean, coalesce((p ->> 'photo_consent')::boolean, false),
          coalesce((p ->> 'mailing_consent')::boolean, false), current_date,
          nullif(left(trim(p ->> 'notes'), 500), ''), not b.collect_payments)
  returning id into v_id;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'insert', 'students', v_id, jsonb_build_object('branch', b.name, 'source', 'manual'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function rpc_enrollment_public(text) from public;
grant execute on function rpc_enrollment_public(text) to anon, authenticated;
revoke all on function rpc_enroll(jsonb, text) from public, anon, authenticated;
grant execute on function rpc_enroll(jsonb, text) to service_role;
revoke all on function rpc_create_student(jsonb) from public, anon;
grant execute on function rpc_create_student(jsonb) to authenticated;

-- ★ תיקון: "בטל" משחזר רק מתוך שורת update. שורת ביטול קודמת באותו רגע (אותו now())
--   נבחרה לפעמים כ"מצב קודם", והסטטוס התאפס ל-null.
create or replace function rpc_cancel_command(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c commands; v_before jsonb; v_rows int;
begin
  -- ★ אותה תפיסה אטומית: ביטול כפול לא יבטל פעמיים.
  update commands set status = 'cancelled'
   where id = p_command_id
     and status = 'applied'
     and created_at > now() - interval '24 hours'
  returning * into c;

  if not found then
    select * into c from commands where id = p_command_id;
    if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if c.status = 'applied' then
      return jsonb_build_object('ok', false, 'reason', 'too_old',
        'message', 'הפעולה ישנה מדי לביטול אוטומטי, אפשר לתקן במערכת.');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_applied', 'status', c.status);
  end if;

  if c.result_id is null then
    return jsonb_build_object('ok', true, 'reversed', 'nothing');
  end if;

  if c.result_table = 'ledger_entries' then
    update ledger_entries set deleted_at = now() where id = c.result_id;
  elsif c.result_table = 'payments' then
    update payments set deleted_at = now() where id = c.result_id;
  elsif c.result_table = 'reminders' then
    update reminders set status = 'cancelled' where id = c.result_id;
  elsif c.result_table = 'students' then
    if c.intent = 'new_student' then
      update students set deleted_at = now() where id = c.result_id;
    else
      -- ★ החזרת הערכים מהשורה שנשמרה לפני העדכון.
      select before into v_before from audit_log
       where table_name = 'students' and row_id = c.result_id and source = 'whatsapp'
         and before is not null and action = 'update'
       order by created_at desc, id desc limit 1;

      if v_before is null then
        return jsonb_build_object('ok', false, 'reason', 'no_snapshot',
          'message', 'לא נשמר מצב קודם, אפשר לתקן במערכת.');
      end if;

      update students s set
        status        = (v_before ->> 'status')::student_status,
        grade         = v_before ->> 'grade',
        parent_phone  = v_before ->> 'parent_phone',
        tuition_total = (v_before ->> 'tuition_total')::numeric,
        notes         = v_before ->> 'notes'
      where s.id = c.result_id;
    end if;
  end if;

  get diagnostics v_rows = row_count;

  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (c.phone, 'delete', c.result_table, c.result_id,
          jsonb_build_object('cancelled_command', c.id), null, 'whatsapp');

  return jsonb_build_object('ok', true, 'reversed', c.result_table, 'rows', v_rows);
end $$;

