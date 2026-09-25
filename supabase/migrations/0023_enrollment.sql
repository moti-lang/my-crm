-- 0023 — הרשמה לחוגים: "דרמחול - החוגים של הניה".
--
--   · settings.enrollment_terms — התקנון (טקסט מלא, הבעלים עורכת)
--   · settings.enrollment_plan  — מבנה התשלום: דמי רישום, שכר לימוד, מספר
--     תשלומים. הכל מההגדרות, הקוד לא מכיר סכומים. f_enrollment_plan()
--     מחשבת ומוודאת שהסכומים מסתכמים בדיוק (אחרת ההרשמה מסרבת).
--   · rpc_enroll (anon): יוצרת תלמידה ממתינה + קישור תשלום על החיוב
--     הראשון (אותו מנגנון SUMIT). הגבלת קצב ואימות שדות במסד.
--   · תשלום SUMIT שנקלט על קישור הרשמה → התלמידה הופכת לפעילה.
--   · rpc_cancel_enrollment: בתוך חודש הניסיון בלבד, זיכוי 75 מדמי הרישום.

-- ─── עמודות ───
alter table students
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists school text,
  add column if not exists registration_fee numeric(10,2) not null default 0,
  add column if not exists installments_total int,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists mailing_consent boolean not null default false,
  add column if not exists trial_started_on date,
  add column if not exists enrolled_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists refund_amount numeric(10,2);

-- זיכוי (החזר דמי רישום) = תשלום שלילי במקור refund. כל השאר עדיין חיובי.
alter table payments drop constraint if exists payments_amount_check;
alter table payments add constraint payments_amount_check check (amount > 0 or (source = 'refund' and amount < 0));

alter table payment_links add column if not exists purpose text not null default 'debt'
  check (purpose in ('debt', 'enrollment'));

-- לוג בקשות הרשמה, להגבלת קצב (לפי טלפון ולפי IP). anon לא נוגע בו ישירות.
create table enrollment_requests (
  id         uuid primary key default gen_random_uuid(),
  phone      text,
  ip         text,
  ok         boolean not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index enrollment_requests_recent_idx on enrollment_requests (created_at);
alter table enrollment_requests enable row level security;
revoke all on enrollment_requests from anon, public;
grant select on enrollment_requests to authenticated;
create policy enrollment_requests_owner on enrollment_requests for select using (auth_role() = 'owner');
grant all on enrollment_requests to service_role;

-- ─── הגדרות: תקנון ומבנה תשלום. הבעלים עורכת מההגדרות, לא מהקוד. ───
insert into settings (key, value) values
('program_name', to_jsonb('דרמחול - החוגים של הניה'::text)),
('enrollment_plan', jsonb_build_object(
  'annual_total', 1200,
  'registration_fee', 100,
  'registration_fee_purpose', 'הסעות לצילומים, מופע, כרטיס לאמא ותלבושות',
  'installments', 10,
  'installment_amount', 110,
  'first_charge', 210,
  'trial_days', 30,
  'cancel_refund', 75
)),
('enrollment_terms', to_jsonb(E'חוגי דרמחול - החוגים של הניה\nאמא יקרה, לפניך הפרטים הנחוצים לדעת בעת הרישום לחוג ❤️\n\n1. הרשמה: בעת ההרשמה יש למלא שם ומשפחה, כיתה ובית ספר, טלפון, כתובת מייל, והרשאה להצטרפות לרשימת התפוצה במייל.\n\n2. תשלום: העלות השנתית 1200 ש"ח. התשלום יגבה באופן הבא: בחיוב הראשון ייגבו 210 ש"ח לפי החישוב הבא: 100 ש"ח דמי רישום המיועדים להסעות לצילומים, מופע, כרטיס לאמא ותלבושות, בתוספת 110 ש"ח תשלום ראשון מתוך שכר הלימוד השוטף. לאחר מכן יגבו עוד 9 תשלומים חודשיים של 110 ש"ח כל אחד.\n\n3. מדיניות ביטולים: ביטול הרשמה לאחר חודש ניסיון - יוחזרו 75 ש"ח מתוך דמי הרישום. לאחר חודש הניסיון לא יתאפשר ביטול.\n\n4. נוכחות: נוכחות סדירה הינה תנאי להשתתפות במופע.\n\n5. במקרה של החסרת שיעורים בשל מלחמה וכו\', ההשלמה תיקבע בע"ה ברגע שיתאפשר.\n\n6. תפקידים במופע: המטרה המרכזית היא הנאה וחוויה. תפקידים משמעותיים יינתנו החל משנה שנייה ואילך, כאשר 2-5 בנות יקבלו תפקיד משמעותי בכל מופע, ושאר הבנות יקבלו תפקידים בגודל זהה.\n\n7. עדכונים: כל העדכונים יועברו דרך קו החוג ובמייל.\n\nבברכת הצלחה ושנת פעילות חוויתית ומועילה! הניה וצוות המורות.'::text))
on conflict (key) do nothing;

-- ★ מבנה התשלום, מחושב ומאומת: דמי רישום + תשלומים × סכום = הסך השנתי,
--   והחיוב הראשון = דמי רישום + תשלום אחד. אחרת — ההגדרה שגויה וההרשמה מסרבת.
create or replace function f_enrollment_plan() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p jsonb; v_total numeric; v_fee numeric; v_n int; v_each numeric; v_first numeric;
begin
  select value into p from settings where key = 'enrollment_plan';
  if p is null then raise exception 'חסרה ההגדרה enrollment_plan'; end if;
  v_total := (p ->> 'annual_total')::numeric; v_fee := (p ->> 'registration_fee')::numeric;
  v_n := (p ->> 'installments')::int; v_each := (p ->> 'installment_amount')::numeric;
  v_first := coalesce((p ->> 'first_charge')::numeric, v_fee + v_each);
  if v_total is null or v_fee is null or v_n is null or v_each is null or v_n < 1 then
    raise exception 'מבנה התשלום בהגדרות חסר שדות (annual_total, registration_fee, installments, installment_amount)';
  end if;
  if v_fee + v_n * v_each <> v_total then
    raise exception 'מבנה התשלום לא מסתכם: דמי רישום % + % תשלומים × % = %, ולא % — לתקן בהגדרות',
      v_fee, v_n, v_each, v_fee + v_n * v_each, v_total;
  end if;
  if v_first <> v_fee + v_each then
    raise exception 'החיוב הראשון (%) חייב להיות דמי רישום + תשלום אחד (%)', v_first, v_fee + v_each;
  end if;
  return p || jsonb_build_object('tuition', v_total - v_fee, 'first_charge', v_first,
                                 'trial_days', coalesce((p ->> 'trial_days')::int, 30),
                                 'cancel_refund', coalesce((p ->> 'cancel_refund')::numeric, 0));
end $$;
-- אותה בדיקה, לקוח: מסך ההגדרות שואל אחרי שמירה אם המבנה תקין.
create or replace function rpc_enrollment_plan() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$ select f_enrollment_plan() $$;
revoke all on function rpc_enrollment_plan() from public, anon;
grant execute on function rpc_enrollment_plan() to authenticated;
revoke all on function f_enrollment_plan() from public, anon, authenticated;

-- ─── מה שדף ההרשמה הציבורי צריך: שם החוג, סניפים פעילים, התקנון, המבנה. ───
create or replace function rpc_enrollment_public() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'program_name', (select value from settings where key = 'program_name'),
    'terms', (select value from settings where key = 'enrollment_terms'),
    'plan', f_enrollment_plan(),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'city', city) order by name), '[]'::jsonb)
                 from branches where deleted_at is null and is_active)
  )
$$;
revoke all on function rpc_enrollment_public() from public;
grant execute on function rpc_enrollment_public() to anon, authenticated;

-- ─── ★ ההרשמה עצמה (anon). אימות שדות והגבלת קצב במסד. ───
create or replace function rpc_enroll(p jsonb, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_first text := left(trim(p ->> 'first_name'), 60);
  v_last  text := left(trim(p ->> 'last_name'), 60);
  v_grade text := left(trim(p ->> 'grade'), 20);
  v_school text := left(trim(p ->> 'school'), 80);
  v_phone text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_email text := lower(left(trim(p ->> 'email'), 120));
  v_branch uuid; v_consent boolean := (p ->> 'mailing_consent')::boolean;
  v_terms boolean := (p ->> 'terms_accepted')::boolean;
  v_plan jsonb; v_season uuid; v_student uuid; v_link jsonb; v_base text; v_token text; v_url text;
  v_n_phone int; v_n_ip int; v_branch_name text;
begin
  if v_phone ~ '^0\d{9}$' then v_phone := '972' || substr(v_phone, 2); end if;
  -- הגבלת קצב: 3 הרשמות בשעה מטלפון, 10 בשעה מ-IP. נרשם גם כשנדחה.
  select count(*) into v_n_phone from enrollment_requests where phone = v_phone and created_at > now() - interval '1 hour';
  select count(*) into v_n_ip from enrollment_requests where p_ip is not null and ip = p_ip and created_at > now() - interval '1 hour';
  -- וגם תקרה כללית: מעל 40 הרשמות בשעה מכל המקורות זה לא הורים, זה סקריפט.
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

  -- אימות שדות. הודעות בעברית, בלי לחשוף כלום.
  if v_first is null or v_first = '' or v_last is null or v_last = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא שם פרטי ושם משפחה'); end if;
  if v_first !~ '^[֐-׿A-Za-z''"\-\s]+$' or v_last !~ '^[֐-׿A-Za-z''"\-\s]+$' then return jsonb_build_object('ok', false, 'error', 'השם יכול להכיל אותיות בלבד'); end if;
  if v_grade is null or v_grade = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא כיתה'); end if;
  if v_school is null or v_school = '' then return jsonb_build_object('ok', false, 'error', 'יש למלא בית ספר'); end if;
  if v_phone !~ '^9725\d{8}$' then return jsonb_build_object('ok', false, 'error', 'מספר הטלפון אינו נייד ישראלי תקין'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'כתובת המייל אינה תקינה'); end if;
  begin v_branch := (p ->> 'branch_id')::uuid; exception when others then v_branch := null; end;
  select name into v_branch_name from branches where id = v_branch and deleted_at is null and is_active;
  if v_branch_name is null then return jsonb_build_object('ok', false, 'error', 'יש לבחור סניף'); end if;
  if v_terms is distinct from true then return jsonb_build_object('ok', false, 'error', 'יש לאשר את התקנון'); end if;

  v_plan := f_enrollment_plan();
  select id into v_season from seasons where is_current limit 1;
  if v_season is null then return jsonb_build_object('ok', false, 'error', 'ההרשמה סגורה כרגע'); end if;

  -- כפילות: אותו שם באותו סניף בעונה הזו, לא מבוטלת — לא נרשמת פעמיים.
  if exists (select 1 from students where season_id = v_season and branch_id = v_branch and deleted_at is null and cancelled_at is null
              and lower(trim(full_name)) = lower(trim(v_first || ' ' || v_last))) then
    insert into enrollment_requests (phone, ip, ok, reason) values (v_phone, p_ip, false, 'duplicate');
    return jsonb_build_object('ok', false, 'error', format('%s %s כבר רשומה ב%s. לפרטים אפשר לפנות לחוג.', v_first, v_last, v_branch_name));
  end if;

  insert into students (season_id, branch_id, full_name, first_name, last_name, grade, school, parent_phone, email,
                        status, source, tuition_total, registration_fee, installments, installments_total,
                        terms_accepted_at, mailing_consent, trial_started_on, enrolled_at, joined_on)
  values (v_season, v_branch, v_first || ' ' || v_last, v_first, v_last, v_grade, v_school, v_phone, v_email,
          'pending', 'enrollment', (v_plan ->> 'tuition')::numeric, (v_plan ->> 'registration_fee')::numeric,
          (v_plan ->> 'installments')::int, (v_plan ->> 'installments')::int,
          now(), coalesce(v_consent, false), current_date, now(), current_date)
  returning id into v_student;

  -- ★ קישור התשלום על החיוב הראשון — אותו מנגנון SUMIT, נוצר אוטומטית.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
  values (v_token, 'tl-' || gen_random_uuid(), v_student, v_branch, (v_plan ->> 'first_charge')::numeric, 'enrollment');
  select trim(both '"' from value::text) into v_base from settings where key = 'app_base_url';
  v_url := coalesce(v_base, '') || '/pay/' || v_token;
  insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
  values ('payment_link', v_student, v_branch, v_phone, v_first || ' ' || v_last,
          format(E'תודה שנרשמת ל%s! כדי להשלים את ההרשמה של %s (%s) — קישור לתשלום החיוב הראשון, %s ₪ (דמי רישום + תשלום ראשון): %s\nהקישור תקף 7 ימים. הקבלה תישלח אלייך אוטומטית 🙏',
                 (select value #>> '{}' from settings where key = 'program_name'), v_first, v_branch_name,
                 to_char((v_plan ->> 'first_charge')::numeric, 'FM999,999,990'), v_url),
          now(), 'payment_link:enroll:' || v_student);

  insert into enrollment_requests (phone, ip, ok) values (v_phone, p_ip, true);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('enrollment', 'insert', 'students', v_student, jsonb_build_object('branch', v_branch_name, 'terms_accepted_at', now()), 'enrollment');
  return jsonb_build_object('ok', true, 'pay_url', v_url, 'amount', (v_plan ->> 'first_charge')::numeric, 'student', v_first, 'branch', v_branch_name);
end $$;
revoke all on function rpc_enroll(jsonb, text) from public;
grant execute on function rpc_enroll(jsonb, text) to anon, authenticated;

-- ─── ★ תשלום שנקלט על קישור הרשמה → פעילה. ───
create or replace function f_activate_on_enrollment_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.purpose = 'enrollment' and new.status in ('paid', 'mismatch') and old.status not in ('paid', 'mismatch') then
    update students set status = 'active' where id = new.student_id and status = 'pending' and cancelled_at is null;
  end if;
  return new;
end $$;
revoke all on function f_activate_on_enrollment_payment() from public, anon, authenticated;
create trigger payment_links_activate after update on payment_links
  for each row execute function f_activate_on_enrollment_payment();

-- ─── ביטול בתוך חודש הניסיון: הבעלים. זיכוי מדמי הרישום. ───
create or replace function rpc_cancel_enrollment(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_plan jsonb; v_days int; v_refund numeric; v_paid numeric;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לבטל הרשמה' using errcode = '42501'; end if;
  select * into s from students where id = p_student and deleted_at is null;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if s.trial_started_on is null then raise exception 'לתלמידה הזו אין חודש ניסיון (לא נרשמה דרך דף ההרשמה)'; end if;
  if s.cancelled_at is not null then raise exception 'ההרשמה כבר בוטלה'; end if;
  v_plan := f_enrollment_plan();
  v_days := (v_plan ->> 'trial_days')::int;
  if current_date > s.trial_started_on + v_days then
    raise exception 'חודש הניסיון הסתיים ב-%. לפי התקנון, אחרי חודש הניסיון לא ניתן לבטל.', to_char(s.trial_started_on + v_days, 'DD/MM/YYYY');
  end if;
  select coalesce(sum(amount), 0) into v_paid from payments where student_id = s.id and deleted_at is null;
  -- הזיכוי חל רק על דמי הרישום, ורק אם שולמו.
  v_refund := case when v_paid >= s.registration_fee then least((v_plan ->> 'cancel_refund')::numeric, s.registration_fee) else 0 end;
  update students set status = 'stopped', stopped_on = current_date, stop_reason = 'ביטול הרשמה בתוך חודש הניסיון',
         cancelled_at = now(), refund_amount = v_refund where id = s.id;
  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  if v_refund > 0 then
    -- זיכוי = תשלום שלילי, מקור cancel: מקטין את "שולם" ומופיע בדוחות כהחזר.
    insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
    values (s.id, s.branch_id, current_date, -v_refund, 'other', 'refund', 'החזר דמי רישום — ביטול בתוך חודש הניסיון');
  end if;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'cancel_enrollment', 'students', s.id, jsonb_build_object('refund', v_refund, 'paid_before', v_paid));
  return jsonb_build_object('ok', true, 'refund', v_refund, 'paid_before', v_paid);
end $$;
revoke all on function rpc_cancel_enrollment(uuid) from public, anon;
grant execute on function rpc_cancel_enrollment(uuid) to authenticated;


-- ─── דמי הרישום נכנסים ליתרה, ונפרדים משכר הלימוד בדוחות ───
-- v_student_balance: due = שכר לימוד - הנחה + דמי רישום. תלמידות ותיקות: דמי רישום 0, בלי שינוי.
drop view if exists v_branch_pnl cascade;   -- v_branch_profitability תלויה בה; נבנות מחדש למטה
drop view if exists v_debtors;
drop view if exists v_student_balance;
create view v_student_balance as
select s.id as student_id, s.branch_id, s.season_id, s.full_name,
       (s.tuition_total - s.discount + s.registration_fee) as due,
       coalesce(p.paid, 0) as paid,
       (s.tuition_total - s.discount + s.registration_fee) - coalesce(p.paid, 0) as balance,
       p.last_paid_on,
       s.registration_fee,
       least(coalesce(p.paid, 0), s.registration_fee) as registration_paid,
       greatest(coalesce(p.paid, 0) - s.registration_fee, 0) as tuition_paid
from students s
left join (select student_id, sum(amount) as paid, max(paid_on) as last_paid_on
             from payments where deleted_at is null group by student_id) p on p.student_id = s.id
where s.deleted_at is null
  and (auth_role() in ('owner', 'accountant')
       or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches())));
alter view v_student_balance set (security_invoker = false);
revoke all on v_student_balance from anon, public;
grant select on v_student_balance to authenticated;

create view v_debtors as SELECT vb.student_id,
    vb.full_name,
    vb.branch_id,
    b.name AS branch_name,
    s.parent_name,
        CASE
            WHEN auth_role() = 'accountant'::user_role THEN NULL::text
            ELSE s.parent_phone
        END AS parent_phone,
    s.status,
    vb.due,
    vb.paid,
    vb.balance,
    vb.last_paid_on,
    COALESCE(vb.last_paid_on, s.joined_on) AS aging_from,
    CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on) AS days_outstanding,
        CASE
            WHEN (CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on)) >= 90 THEN 90
            WHEN (CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on)) >= 60 THEN 60
            WHEN (CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on)) >= 30 THEN 30
            ELSE 0
        END AS aging_bucket
   FROM v_student_balance vb
     JOIN students s ON s.id = vb.student_id
     JOIN branches b ON b.id = vb.branch_id
  WHERE vb.balance > 0::numeric AND s.deleted_at IS NULL AND (s.status = ANY (ARRAY['active'::student_status, 'pending'::student_status]));
alter view v_debtors set (security_invoker = false);
revoke all on v_debtors from anon, public;
grant select on v_debtors to authenticated;

create view v_branch_pnl as
select b.id as branch_id, b.name,
  (select coalesce(sum(p.amount),0) from payments p
     join students s on s.id = p.student_id
     where p.branch_id = b.id and p.deleted_at is null and s.deleted_at is null) as income_students,
  -- דמי רישום: מיועדים להסעות/מופע/תלבושות, לא שכר לימוד. מופרדים בדוחות.
  (select coalesce(sum(vb.registration_paid),0) from v_student_balance vb where vb.branch_id=b.id) as income_registration_fees,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='income' and l.scope='branch' and l.deleted_at is null) as income_other,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='expense' and l.scope='branch' and l.deleted_at is null) as expenses,
  (select coalesce(sum(greatest(vb.balance, 0)),0) from v_student_balance vb where vb.branch_id=b.id) as open_debt,
  (select count(*) from students s
     where s.branch_id=b.id and s.status='active' and s.deleted_at is null) as active_students
from branches b
where b.deleted_at is null
  and (auth_role() in ('owner', 'accountant')
       or (auth_role() = 'branch_manager' and b.id in (select my_branches())));
alter view v_branch_pnl set (security_invoker = false);
revoke all on v_branch_pnl from anon, public;
grant select on v_branch_pnl to authenticated;

create view v_branch_profitability as
select b.branch_id, b.name, b.active_students, b.income_students, b.income_registration_fees, b.income_other, b.expenses, b.open_debt,
       b.income_students + b.income_other - b.expenses as profit_before,
       coalesce(a.allocated_amount, 0) as allocated,
       b.income_students + b.income_other - b.expenses - coalesce(a.allocated_amount, 0) as profit_after
from v_branch_pnl b
left join v_general_allocation a on a.branch_id = b.branch_id
where auth_role() in ('owner', 'accountant');
alter view v_branch_profitability set (security_invoker = false);
revoke all on v_branch_profitability from anon, public;
grant select on v_branch_profitability to authenticated;

drop view if exists v_student_overview;
create view v_student_overview as SELECT s.id,
    s.season_id,
    s.branch_id,
    b.name AS branch_name,
    s.full_name,
    s.grade,
    s.group_name,
    s.parent_name,
    s.parent_phone,
    s.status,
    s.joined_on,
    s.stopped_on,
    s.stop_reason,
    s.tuition_total,
    s.discount,
    s.discount_reason,
    s.installments,
    s.photo_consent,
    s.notes,
    s.tuition_total - s.discount + s.registration_fee AS due,
    COALESCE(p.paid, 0::numeric) AS paid,
    s.tuition_total - s.discount + s.registration_fee - COALESCE(p.paid, 0::numeric) AS balance,
    s.registration_fee,
    s.installments_total,
    s.school,
    s.email,
    s.trial_started_on,
    s.enrolled_at,
    s.terms_accepted_at,
    s.cancelled_at,
    s.refund_amount,
    s.mailing_consent,
    s.source,
    p.last_paid_on,
    COALESCE(a.attended, 0::bigint) AS lessons_attended,
    COALESCE(a.total, 0::bigint) AS lessons_total,
        CASE
            WHEN COALESCE(a.total, 0::bigint) > 0 THEN round(100.0 * a.attended::numeric / a.total::numeric)
            ELSE NULL::numeric
        END AS attendance_pct
   FROM students s
     JOIN branches b ON b.id = s.branch_id
     LEFT JOIN ( SELECT payments.student_id,
            sum(payments.amount) AS paid,
            max(payments.paid_on) AS last_paid_on
           FROM payments
          WHERE payments.deleted_at IS NULL
          GROUP BY payments.student_id) p ON p.student_id = s.id
     LEFT JOIN ( SELECT attendance.student_id,
            count(*) FILTER (WHERE attendance.mark = ANY (ARRAY['present'::attendance_mark, 'late'::attendance_mark])) AS attended,
            count(*) AS total
           FROM attendance
          GROUP BY attendance.student_id) a ON a.student_id = s.id
  WHERE s.deleted_at IS NULL;
alter view v_student_overview set (security_invoker = true);
revoke all on v_student_overview from anon, public;
grant select on v_student_overview to authenticated;

-- הנהלת חשבונות: דמי הרישום עמודה נפרדת.
drop view if exists v_students_accounting;
create view v_students_accounting as
select s.id, s.season_id, s.branch_id, s.full_name, s.grade, s.group_name, s.status, s.joined_on, s.stopped_on,
       s.tuition_total, s.discount, s.installments, s.registration_fee, s.installments_total, s.school, s.enrolled_at, s.cancelled_at, s.refund_amount
from students s
where s.deleted_at is null and auth_role() = 'accountant';
alter view v_students_accounting set (security_invoker = false);
revoke all on v_students_accounting from anon, public;
grant select on v_students_accounting to authenticated;

-- ─── תצוגות ───
-- רשימת התפוצה: מי שאישרה. הבעלים בלבד.
create view v_mailing_list as
select s.id, s.full_name, s.parent_name, s.parent_phone, s.email, b.name as branch_name, s.status, s.enrolled_at
from students s join branches b on b.id = s.branch_id
where s.deleted_at is null and s.mailing_consent and auth_role() = 'owner';
alter view v_mailing_list set (security_invoker = false);
revoke all on v_mailing_list from anon, public;
grant select on v_mailing_list to authenticated;

-- נרשמו ולא שילמו: הגיעו מדף ההרשמה, החיוב הראשון עוד לא נקלט.
create view v_enrolled_unpaid as
select s.id as student_id, s.full_name, s.parent_phone, s.email, s.branch_id, b.name as branch_name,
       s.enrolled_at, (current_date - s.enrolled_at::date) as days_since,
       l.amount as first_charge, l.status as link_status, l.expires_at
from students s
join branches b on b.id = s.branch_id
left join lateral (select amount, status, expires_at from payment_links where student_id = s.id and purpose = 'enrollment' order by created_at desc limit 1) l on true
where s.deleted_at is null and s.source = 'enrollment' and s.status = 'pending' and s.cancelled_at is null
  and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches())));
alter view v_enrolled_unpaid set (security_invoker = false);
revoke all on v_enrolled_unpaid from anon, public;
grant select on v_enrolled_unpaid to authenticated;

-- הסיכום היומי (service_role): נרשמו היום, שילמו, ומי מעל 3 ימים בלי תשלום.
create or replace function rpc_enrollment_digest(p_since date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'enrolled', (select count(*) from students where source = 'enrollment' and deleted_at is null and enrolled_at::date >= p_since),
    'paid', (select count(*) from students s where s.source = 'enrollment' and s.deleted_at is null and s.enrolled_at::date >= p_since
               and exists (select 1 from payment_links l where l.student_id = s.id and l.purpose = 'enrollment' and l.status in ('paid','mismatch'))),
    'overdue', (select coalesce(jsonb_agg(jsonb_build_object('name', s.full_name, 'days', current_date - s.enrolled_at::date) order by s.enrolled_at), '[]'::jsonb)
                from students s where s.source = 'enrollment' and s.deleted_at is null and s.status = 'pending' and s.cancelled_at is null
                  and s.enrolled_at < now() - interval '3 days')
  )
$$;
revoke all on function rpc_enrollment_digest(date) from public, anon, authenticated;
grant execute on function rpc_enrollment_digest(date) to service_role;

-- כרטיס התלמידה: איזה תשלום מתוך כמה. דמי הרישום נפרדים משכר הלימוד.
create or replace function rpc_installment_progress(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'registration_fee', s.registration_fee,
    'registration_paid', least(coalesce(p.paid, 0), s.registration_fee),
    'tuition', s.tuition_total - s.discount,
    'tuition_paid', greatest(coalesce(p.paid, 0) - s.registration_fee, 0),
    'installments_total', s.installments_total,
    'installment_amount', case when s.installments_total > 0 then round((s.tuition_total - s.discount) / s.installments_total, 2) end,
    'installments_paid', case when s.installments_total > 0 and (s.tuition_total - s.discount) > 0
                              then least(s.installments_total, floor(greatest(coalesce(p.paid, 0) - s.registration_fee, 0) * s.installments_total / (s.tuition_total - s.discount))) end,
    'balance', s.tuition_total - s.discount + s.registration_fee - coalesce(p.paid, 0)
  )
  from students s
  left join (select student_id, sum(amount) as paid from payments where deleted_at is null group by student_id) p on p.student_id = s.id
  where s.id = p_student and s.deleted_at is null
    and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches())))
$$;
revoke all on function rpc_installment_progress(uuid) from public, anon;
grant execute on function rpc_installment_progress(uuid) to authenticated;

-- הסיכום היומי לבעלים: שתי שורות הרשמה. (העדכון רק אם התבנית לא נערכה ידנית.)
update message_templates
   set body = E'סיכום היום: נוכחות דווחה ב-{reported}/{total} סניפים · נכנסו {income} · {new_leads} פניות חדשות · {debtors} חייבות בסך {debt}.\nהרשמות היום: {enrollment}.\n{enrollment_overdue}.'
 where key = 'owner_daily' and body not like '%{enrollment}%';
