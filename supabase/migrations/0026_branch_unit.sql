-- 0026 — סניף = יחידה עצמאית.
--
-- לכל סניף: קישור הרשמה ייחודי, תקנון, מבנה תשלום, קבוצות גיל, פתיחה/סגירה
-- של ההרשמה ומכסה אופציונלית שסוגרת לבד. ההגדרות הגלובליות (settings:
-- enrollment_plan / enrollment_terms) הופכות ל"ברירת מחדל לסניף חדש": סניף
-- שנוצר מקבל עותק שלהן, ומשם משתנה בלי לגעת באחרים.
--
-- ★ תלמידה נשארת על התנאים שאישרה: נשמרים אצלה נוסח התקנון ומבנה התשלום
--   (terms_text, plan_snapshot), כמו שכר הלימוד ודמי הרישום שכבר נשמרו.
-- ★ הבדיקה שהתשלומים מסתכמים לשכר הלימוד — לכל סניף בנפרד, במסד.
-- ★ שאלות ומידע לסוכן: שכבה לסניף מעל הכללי (branch_id). ההרכבה בקוד.

-- ─────────── הסניף ───────────
alter table branches
  add column if not exists enroll_token text,
  add column if not exists enrollment_open boolean not null default true,
  add column if not exists capacity int,
  add column if not exists terms text,
  add column if not exists plan jsonb,
  add column if not exists age_groups text;
alter table branches alter column enroll_token set default replace(gen_random_uuid()::text, '-', '');
update branches set enroll_token = replace(gen_random_uuid()::text, '-', '') where enroll_token is null;
alter table branches alter column enroll_token set not null;
alter table branches drop constraint if exists branches_enroll_token_key;
alter table branches add constraint branches_enroll_token_key unique (enroll_token);
alter table branches drop constraint if exists branches_capacity_check;
alter table branches add constraint branches_capacity_check check (capacity is null or capacity > 0);

-- ─────────── התלמידה: התנאים שאישרה ───────────
alter table students
  add column if not exists terms_text text,
  add column if not exists plan_snapshot jsonb;

-- ─────────── מבנה תשלום: בדיקה אחת, לכל מקור ───────────
-- דמי רישום + תשלומים × סכום = הסך השנתי; החיוב הראשון = דמי רישום + תשלום אחד.
create or replace function f_plan_check(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_total numeric; v_fee numeric; v_n int; v_each numeric; v_first numeric;
begin
  if p is null then raise exception 'חסר מבנה תשלום'; end if;
  v_total := (p ->> 'annual_total')::numeric; v_fee := (p ->> 'registration_fee')::numeric;
  v_n := (p ->> 'installments')::int; v_each := (p ->> 'installment_amount')::numeric;
  v_first := coalesce((p ->> 'first_charge')::numeric, v_fee + v_each);
  if v_total is null or v_fee is null or v_n is null or v_each is null or v_n < 1 then
    raise exception 'מבנה התשלום חסר שדות (שכר לימוד שנתי, דמי רישום, מספר תשלומים, סכום לתשלום)';
  end if;
  if v_fee < 0 or v_each <= 0 then raise exception 'דמי רישום וסכום לתשלום חייבים להיות חיוביים'; end if;
  if v_fee + v_n * v_each <> v_total then
    raise exception 'מבנה התשלום לא מסתכם: דמי רישום % + % תשלומים × % = %, ולא %',
      v_fee, v_n, v_each, v_fee + v_n * v_each, v_total;
  end if;
  if v_first <> v_fee + v_each then
    raise exception 'החיוב הראשון (%) חייב להיות דמי רישום + תשלום אחד (%)', v_first, v_fee + v_each;
  end if;
  return p || jsonb_build_object('tuition', v_total - v_fee, 'first_charge', v_first,
                                 'trial_days', coalesce((p ->> 'trial_days')::int, 30),
                                 'cancel_refund', coalesce((p ->> 'cancel_refund')::numeric, 0));
end $$;
revoke all on function f_plan_check(jsonb) from public, anon, authenticated;

-- ברירת המחדל (מסך ההגדרות) — אותה בדיקה.
create or replace function f_enrollment_plan() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select f_plan_check((select value from settings where key = 'enrollment_plan'))
$$;
revoke all on function f_enrollment_plan() from public, anon, authenticated;

-- ─────────── סניף חדש מקבל עותק של ברירת המחדל; מבנה שגוי נדחה ───────────
create or replace function f_branch_defaults() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.plan is null then new.plan := (select value from settings where key = 'enrollment_plan'); end if;
  if new.terms is null then new.terms := (select value #>> '{}' from settings where key = 'enrollment_terms'); end if;
  if new.plan is not null then perform f_plan_check(new.plan); end if;
  return new;
end $$;
revoke all on function f_branch_defaults() from public, anon, authenticated;
drop trigger if exists branches_defaults on branches;
create trigger branches_defaults before insert or update of plan, terms on branches
  for each row execute function f_branch_defaults();

-- הסניפים הקיימים: עותק של ההגדרות הנוכחיות.
update branches set plan = null where plan is null;  -- מפעיל את הטריגר (plan/terms ריקים → עותק)

-- ─────────── מצב ההרשמה של סניף: פתוח, סגור, מלא ───────────
create or replace function f_branch_enrollment_state(p_branch uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with b as (select * from branches where id = p_branch),
       t as (select count(*)::int as taken from students s
              where s.branch_id = p_branch and s.deleted_at is null and s.cancelled_at is null
                and s.status in ('active', 'pending')
                and s.season_id = (select id from seasons where is_current limit 1))
  select jsonb_build_object(
    'open', b.is_active and b.deleted_at is null and b.enrollment_open and (b.capacity is null or t.taken < b.capacity),
    'reason', case
      when not b.is_active or b.deleted_at is not null then 'inactive'
      when not b.enrollment_open then 'closed'
      when b.capacity is not null and t.taken >= b.capacity then 'full'
      else null end,
    'taken', t.taken, 'capacity', b.capacity)
  from b, t
$$;
revoke all on function f_branch_enrollment_state(uuid) from public, anon;
grant execute on function f_branch_enrollment_state(uuid) to authenticated;

-- הסניף שהקישור מצביע עליו. בלי קישור: רק כשיש סניף פעיל אחד (תאימות ל-/enroll).
create or replace function f_enroll_branch(p_token text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when coalesce(p_token, '') <> '' then
      (select id from branches where enroll_token = p_token and deleted_at is null)
    when (select count(*) from branches where deleted_at is null and is_active) = 1 then
      (select id from branches where deleted_at is null and is_active)
    else null end
$$;
revoke all on function f_enroll_branch(text) from public, anon, authenticated;

-- ─────────── הדף הציבורי: הסניף של הקישור בלבד ───────────
drop function if exists rpc_enrollment_public();
create or replace function rpc_enrollment_public(p_token text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_branch uuid; b branches%rowtype; v_state jsonb;
begin
  v_branch := f_enroll_branch(p_token);
  if v_branch is null then
    return jsonb_build_object('ok', false,
      'error', case when coalesce(p_token, '') = '' then 'להרשמה יש להיכנס דרך הקישור של הסניף' else 'הקישור להרשמה אינו תקין' end);
  end if;
  select * into b from branches where id = v_branch;
  v_state := f_branch_enrollment_state(v_branch);
  return jsonb_build_object(
    'ok', true,
    'program_name', (select value #>> '{}' from settings where key = 'program_name'),
    'branch', jsonb_build_object('name', b.name, 'city', b.city, 'schedule', b.schedule_text, 'age_groups', b.age_groups),
    'terms', b.terms,
    'plan', f_plan_check(b.plan),
    'open', (v_state ->> 'open')::boolean,
    'closed_reason', v_state ->> 'reason');
end $$;
revoke all on function rpc_enrollment_public(text) from public;
grant execute on function rpc_enrollment_public(text) to anon, authenticated;

-- ─────────── ★ ההרשמה: לפי הקישור, בתנאי הסניף ───────────
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
  v_branch uuid; b branches%rowtype; v_state jsonb;
  v_plan jsonb; v_season uuid; v_student uuid; v_base text; v_token text; v_url text;
  v_n_phone int; v_n_ip int;
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

  -- ★ הסניף נקבע מהקישור, לא מהדפדפן. נעילה: שתי הרשמות במקביל לא עוברות את המכסה.
  v_branch := f_enroll_branch(p ->> 'enroll_token');
  if v_branch is null then return jsonb_build_object('ok', false, 'error', 'הקישור להרשמה אינו תקין'); end if;
  select * into b from branches where id = v_branch for update;
  v_state := f_branch_enrollment_state(v_branch);
  if not (v_state ->> 'open')::boolean then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'branch_' || coalesce(v_state ->> 'reason', 'closed'));
    return jsonb_build_object('ok', false, 'error', case v_state ->> 'reason'
      when 'full' then format('ההרשמה ל%s מלאה. אפשר לפנות לחוג לרשימת המתנה.', b.name)
      else format('ההרשמה ל%s סגורה כרגע.', b.name) end);
  end if;

  v_plan := f_plan_check(b.plan);
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;

  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(trim(v_first || ' ' || v_last))) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'duplicate');
    return jsonb_build_object('ok', false, 'error', format('%s %s כבר רשומה ב%s. לפרטים אפשר לפנות לחוג.', v_first, v_last, b.name));
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_accepted_at, terms_text, plan_snapshot, mailing_consent, trial_started_on, enrolled_at, joined_on)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last, v_grade, v_school, v_phone, v_email,
          'pending', 'enrollment', (v_plan ->> 'tuition')::numeric, (v_plan ->> 'registration_fee')::numeric,
          (v_plan ->> 'installments')::int, (v_plan ->> 'installments')::int,
          now(), b.terms, v_plan, coalesce(v_consent, false), current_date, now(), current_date)
  returning id into v_student;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
  values (v_token, 'tl-' || gen_random_uuid(), v_student, v_branch, (v_plan ->> 'first_charge')::numeric, 'enrollment');
  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
  values ('payment_link', v_student, v_branch, v_phone, v_first || ' ' || v_last,
          format(E'תודה שנרשמת ל%s! כדי להשלים את ההרשמה של %s (%s) — קישור לתשלום החיוב הראשון, %s ₪ (דמי רישום + תשלום ראשון): %s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 (select value #>> '{}' from settings where key = 'program_name'), v_first, b.name,
                 to_char((v_plan ->> 'first_charge')::numeric, 'FM999,999,990'), v_url),
          now(), 'payment_link:enroll:' || v_student);

  insert into enrollment_requests (phone, ip, ok) values (v_phone, p_ip, true);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('enrollment', 'insert', 'students', v_student, jsonb_build_object('branch', b.name, 'terms_accepted_at', now()), 'enrollment');
  return jsonb_build_object('ok', true, 'pay_url', v_url, 'amount', (v_plan ->> 'first_charge')::numeric, 'student', v_first, 'branch', b.name);
end $$;
revoke all on function rpc_enroll(jsonb, text) from public, anon, authenticated;
grant execute on function rpc_enroll(jsonb, text) to service_role;

-- ─────────── ביטול בחודש הניסיון: לפי התנאים שהתלמידה אישרה ───────────
create or replace function rpc_cancel_enrollment(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_plan jsonb; v_days int; v_refund numeric; v_paid numeric;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לבטל הרשמה' using errcode = '42501'; end if;
  select * into s from students where id = p_student and deleted_at is null;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if s.trial_started_on is null then raise exception 'לתלמידה הזו אין חודש ניסיון (לא נרשמה דרך דף ההרשמה)'; end if;
  if s.cancelled_at is not null then raise exception 'ההרשמה כבר בוטלה'; end if;
  v_plan := coalesce(s.plan_snapshot, f_plan_check((select plan from branches where id = s.branch_id)));
  v_days := coalesce((v_plan ->> 'trial_days')::int, 30);
  if current_date > s.trial_started_on + v_days then
    raise exception 'חודש הניסיון הסתיים ב-%. לפי התקנון, אחרי חודש הניסיון לא ניתן לבטל.', to_char(s.trial_started_on + v_days, 'DD/MM/YYYY');
  end if;
  select coalesce(sum(amount), 0) into v_paid from payments where student_id = s.id and deleted_at is null;
  v_refund := case when v_paid >= s.registration_fee then least(coalesce((v_plan ->> 'cancel_refund')::numeric, 0), s.registration_fee) else 0 end;
  update students set status = 'stopped', stopped_on = current_date, stop_reason = 'ביטול הרשמה בתוך חודש הניסיון',
         cancelled_at = now(), refund_amount = v_refund where id = s.id;
  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  if v_refund > 0 then
    insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
    values (s.id, s.branch_id, current_date, -v_refund, 'other', 'refund', 'החזר דמי רישום — ביטול בתוך חודש הניסיון');
  end if;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'cancel_enrollment', 'students', s.id, jsonb_build_object('refund', v_refund, 'paid_before', v_paid));
  return jsonb_build_object('ok', true, 'refund', v_refund, 'paid_before', v_paid);
end $$;
revoke all on function rpc_cancel_enrollment(uuid) from public, anon;
grant execute on function rpc_cancel_enrollment(uuid) to authenticated;

-- ─────────── הוספת תלמידה ידנית (בלי דף ההרשמה) ───────────
-- תנאי הסניף נשמרים אצלה כמו בהרשמה. אין קישור תשלום אוטומטי.
create or replace function rpc_create_student(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid; b branches%rowtype; v_plan jsonb; v_season uuid; v_id uuid;
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
  v_plan := f_plan_check(b.plan);

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_name, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_text, plan_snapshot, mailing_consent, joined_on, notes)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last,
          nullif(left(trim(p ->> 'grade'), 20), ''), nullif(left(trim(p ->> 'school'), 80), ''),
          nullif(left(trim(p ->> 'parent_name'), 80), ''), nullif(v_phone, ''), v_email,
          v_status, 'manual', (v_plan ->> 'tuition')::numeric, (v_plan ->> 'registration_fee')::numeric,
          (v_plan ->> 'installments')::int, (v_plan ->> 'installments')::int,
          b.terms, v_plan, coalesce((p ->> 'mailing_consent')::boolean, false), current_date,
          nullif(left(trim(p ->> 'notes'), 500), ''))
  returning id into v_id;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'insert', 'students', v_id, jsonb_build_object('branch', b.name, 'source', 'manual'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function rpc_create_student(jsonb) from public, anon;
grant execute on function rpc_create_student(jsonb) to authenticated;

-- ─────────── שאלות ומידע לסוכן: שכבה לסניף ───────────
alter table faq_entries add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table knowledge_sections add column if not exists branch_id uuid references branches(id) on delete cascade;

-- למסך הסניף: מצב ההרשמה (פתוח/סגור/מלא, כמה נתפסו מהמכסה). רק מי שרואה את הסניף.
create or replace function rpc_branch_enrollment_state(p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and p_branch in (select my_branches())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  return f_branch_enrollment_state(p_branch);
end $$;
revoke all on function rpc_branch_enrollment_state(uuid) from public, anon;
grant execute on function rpc_branch_enrollment_state(uuid) to authenticated;
revoke all on function f_branch_enrollment_state(uuid) from authenticated;
