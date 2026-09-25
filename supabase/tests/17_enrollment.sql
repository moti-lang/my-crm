-- 17_enrollment.sql — הרשמה לחוגים: מבנה תשלום מאומת, דף ציבורי בטוח,
-- תלמידה ממתינה + קישור 210, פעילה אחרי תשלום, ביטול בחודש הניסיון.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

create or replace function t_enroll(p_first text, p_phone text default '0521112233', p_ip text default '1.2.3.4', p_terms boolean default true) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'כהן', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', p_phone, 'email', lower(p_first) || '@example.com', 'branch_id', 'bbbbbbbb-0000-0000-0000-000000000001',
    'mailing_consent', true, 'terms_accepted', p_terms), p_ip) $$;

-- כמו הפונקציה enroll: service_role מעביר את הגוף כמו שהוא. anon אינו קורא ל-rpc_enroll ישירות (0024).
create or replace function t_enroll_raw(p jsonb, p_ip text default '1.2.3.4') returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select rpc_enroll(p, p_ip) $$;

\echo 'מבנה התשלום — מההגדרות, ומסתכם בדיוק:'
begin;
select assert_eq((f_enrollment_plan() ->> 'annual_total')::bigint, 1200, 'סך שנתי 1,200');
select assert_true(rpc_enrollment_plan() = f_enrollment_plan(), 'rpc_enrollment_plan (למסך ההגדרות) = אותו חישוב');
select assert_eq((f_enrollment_plan() ->> 'first_charge')::bigint, 210, 'חיוב ראשון 210 = 100 דמי רישום + 110');
select assert_eq((f_enrollment_plan() ->> 'tuition')::bigint, 1100, 'שכר לימוד = 1,200 − 100 דמי רישום');
select assert_true((f_enrollment_plan() ->> 'registration_fee')::numeric + (f_enrollment_plan() ->> 'installments')::int * (f_enrollment_plan() ->> 'installment_amount')::numeric = 1200, '★ 100 + 10 × 110 = 1,200 בדיוק');
update settings set value = value || '{"installment_amount": 100, "first_charge": 200}' where key = 'enrollment_plan';
select assert_no_effect('★ הגדרה שלא מסתכמת ל-1,200 — ההרשמה מסרבת (בלי ליצור תלמידה)', $a$select t_enroll('בדיקה')$a$, 'select count(*)::text from students');
rollback;

\echo 'הדף הציבורי:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select assert_true(rpc_enrollment_public() ->> 'program_name' = 'דרמחול - החוגים של הניה', 'שם החוג מההגדרות');
select assert_true(length(rpc_enrollment_public() ->> 'terms') > 500 and (rpc_enrollment_public() ->> 'terms') like '%מדיניות ביטולים%', 'התקנון המלא מוצג');
select assert_eq((select count(*) from jsonb_array_elements(rpc_enrollment_public() -> 'branches')), 5, 'הסניפים הפעילים');
select assert_true(rpc_enrollment_public()::text !~ '(972|parent_phone|tuition_total|default_tuition|supervisor)', '★ הדף לא חושף טלפונים או נתונים פנימיים');
select assert_no_table_privilege('anon', '{students,enrollment_requests,payment_links}');
select assert_no_execute('anon', 'rpc_enroll(jsonb, text)');
select assert_no_execute('authenticated', 'rpc_enroll(jsonb, text)');
rollback;

\echo 'הרשמה: תלמידה ממתינה + קישור 210 + הודעה:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select assert_true((t_enroll('רבקה') ->> 'ok')::boolean, '★ ההרשמה מצליחה');
reset role;
select assert_eq((select count(*) from students where first_name = 'רבקה' and status = 'pending' and source = 'enrollment'), 1, '★ תלמידה ממתינה, מקור enrollment');
select assert_true((select tuition_total = 1100 and registration_fee = 100 and installments_total = 10 and terms_accepted_at is not null and mailing_consent and trial_started_on = current_date and parent_phone = '972521112233' from students where first_name = 'רבקה'), '★ מבנה התשלום הוחל; אישור התקנון נשמר עם זמן; חודש הניסיון התחיל היום');
select assert_eq((select amount::bigint from payment_links where purpose = 'enrollment'), 210, '★ קישור תשלום אוטומטי על 210');
select assert_eq((select count(*) from reminders where kind = 'payment_link' and body like '%210%' and body like '%/pay/%'), 1, '★ ההודעה עם הקישור בתור הוואטסאפ');
select assert_true((t_enroll('רבקה', '0521112233', '1.2.3.4') ->> 'ok')::boolean = false, 'אותה תלמידה פעמיים — נדחית');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select balance::bigint from v_student_balance where full_name = 'רבקה כהן'), 1200, 'היתרה: 1,200 (דמי רישום + שכר לימוד)');
select assert_eq((select count(*) from v_enrolled_unpaid where full_name = 'רבקה כהן'), 1, 'מופיעה ב"נרשמו ולא שילמו"');
select assert_eq((select count(*) from v_mailing_list where full_name = 'רבקה כהן' and email = 'רבקה@example.com' or full_name = 'רבקה כהן'), 1, '★ הבעלים רואה אותה ברשימת התפוצה (אישרה)');
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from v_mailing_list), 0, 'מנהלת סניף לא רואה את רשימת התפוצה');
rollback;

\echo 'אימות שדות והגבלת קצב:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select assert_true((t_enroll('א', '12345') ->> 'error') like '%טלפון%', 'טלפון לא תקין — הודעה בעברית');
select assert_true((t_enroll_raw('{"first_name":"<script>","last_name":"x","grade":"ד","school":"s","phone":"0521112233","email":"a@b.co","branch_id":"bbbbbbbb-0000-0000-0000-000000000001","terms_accepted":true}') ->> 'error') like '%אותיות%', '★ שם עם תווים זרים נדחה');
select assert_true((t_enroll('שרה', '0521112233', '1.2.3.4', false) ->> 'error') like '%תקנון%', '★ בלי אישור תקנון — נדחה');
select assert_true((t_enroll_raw('{"first_name":"שרה","last_name":"לוי","grade":"ד","school":"s","phone":"0521112233","email":"a@b.co","branch_id":"00000000-0000-0000-0000-000000000000","terms_accepted":true}') ->> 'error') like '%סניף%', 'סניף לא קיים — נדחה');
select assert_true((t_enroll_raw('{"first_name":"שרה","last_name":"לוי","grade":"ד","school":"s","phone":"0521112233","email":"a@b.co","branch_id":"bbbbbbbb-0000-0000-0000-000000000001","terms_accepted":true,"tuition_total":1,"status":"active"}') ->> 'ok')::boolean, 'שדות זרים בבקשה מתעלמים');
reset role;
select assert_true((select tuition_total = 1100 and status = 'pending' from students where full_name = 'שרה לוי'), '★ אי אפשר להזריק סכום או סטטוס דרך הדף');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('בת-שבע', '0529999999', '9.9.9.9'); select t_enroll('בתיה', '0529999999', '9.9.9.9'); select t_enroll('ברכה', '0529999999', '9.9.9.9');
select assert_true((t_enroll('בלומה', '0529999999', '9.9.9.9') ->> 'error') like '%יותר מדי%', '★ הרשמה רביעית מאותו טלפון בשעה — נחסמת');
-- IP: עשרה טלפונים שונים מאותו IP — ה-11 נחסם.
select count(t_enroll('גילה' || chr(1487 + i), '05210000' || lpad(i::text, 2, '0'), '7.7.7.7')) from generate_series(1, 10) i;
select assert_true((t_enroll('גאולה', '0529876543', '7.7.7.7') ->> 'error') like '%יותר מדי%', '★ הרשמה 11 מאותו IP בשעה — נחסמת גם עם טלפון חדש');
select assert_true((t_enroll('גאולה', '0529876543', '8.8.8.8') ->> 'ok')::boolean, 'מ-IP אחר — עוברת');
reset role;
select assert_eq((select count(*) from system_alerts where kind = 'enrollment_flood'), 2, 'התראה לבעלים על הצפה — אחת לטלפון, אחת ל-IP');
rollback;

\echo 'תשלום נקלט → פעילה; כרטיס התלמידה:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('מרים');
reset role;
select assert_true((rpc_record_sumit_payment((select external_identifier from payment_links where purpose = 'enrollment'), 'S-1', 210, now(), 'D-1') ->> 'ok')::boolean, 'התשלום נרשם');
select assert_eq((select count(*) from students where first_name = 'מרים' and status = 'active'), 1, '★ אחרי החיוב הראשון — פעילה אוטומטית');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_installment_progress((select id from students where first_name = 'מרים')) ->> 'installments_paid')::int = 1, '★ הכרטיס: תשלום 1 מתוך 10');
select assert_true((rpc_installment_progress((select id from students where first_name = 'מרים')) ->> 'registration_paid')::numeric = 100 and (rpc_installment_progress((select id from students where first_name = 'מרים')) ->> 'balance')::numeric = 990, 'דמי רישום שולמו; נותרו 990');
select assert_eq((select registration_paid::bigint from v_student_balance where full_name = 'מרים כהן'), 100, 'בדוחות: דמי רישום נפרדים משכר הלימוד');
select assert_eq((select tuition_paid::bigint from v_student_balance where full_name = 'מרים כהן'), 110, 'ו-110 לשכר הלימוד');
select assert_eq((select count(*) from v_enrolled_unpaid where full_name = 'מרים כהן'), 0, 'יצאה מ"נרשמו ולא שילמו"');
rollback;

\echo 'ביטול בחודש הניסיון:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('נעמי');
reset role;
select rpc_record_sumit_payment((select external_identifier from payment_links where purpose = 'enrollment'), 'S-2', 210, now(), 'D-2');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('★ מנהלת סניף לא מבטלת', format('select rpc_cancel_enrollment(%L)', (select id from students where first_name = 'נעמי')), 'select count(*)::text from payments');
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((rpc_cancel_enrollment((select id from students where first_name = 'נעמי')) ->> 'refund')::bigint, 75, '★ ביטול בתוך החודש — זיכוי 75');
select assert_true((select status = 'stopped' and cancelled_at is not null and refund_amount = 75 from students where first_name = 'נעמי'), 'הופסקה, עם תיעוד');
select assert_eq((select count(*) from payments where source = 'refund' and amount = -75), 1, 'הזיכוי נרשם כתשלום שלילי');
select assert_eq((select count(*) from v_mailing_list where full_name = 'נעמי כהן'), 1, 'נשארת ברשימת התפוצה (אישרה)');
rollback;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('חנה');
reset role;
update students set trial_started_on = current_date - 31 where first_name = 'חנה';
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_no_effect('★ אחרי חודש הניסיון — הביטול חסום', format('select rpc_cancel_enrollment(%L)', (select id from students where first_name = 'חנה')), $p$select status::text from students where first_name = 'חנה'$p$);
do $$ begin
  perform rpc_cancel_enrollment((select id from students where first_name = 'חנה'));
exception when others then perform assert_true(sqlerrm like 'חודש הניסיון הסתיים%', 'ההסבר: ' || sqlerrm); end $$;
rollback;

\echo 'הסיכום היומי:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('דבורה'); select t_enroll('אסתר', '0523333333', '2.2.2.2');
reset role;
select rpc_record_sumit_payment((select external_identifier from payment_links l join students s on s.id = l.student_id where s.first_name = 'אסתר'), 'S-3', 210, now(), null);
update students set enrolled_at = now() - interval '4 days' where first_name = 'דבורה';
select assert_eq((rpc_enrollment_digest(current_date - 7) ->> 'enrolled')::bigint, 2, 'נרשמו השבוע: 2');
select assert_eq((rpc_enrollment_digest(current_date - 7) ->> 'paid')::bigint, 1, 'מהן שילמו: 1');
select assert_true((rpc_enrollment_digest(current_date) -> 'overdue')::text like '%דבורה כהן%' and (rpc_enrollment_digest(current_date) -> 'overdue')::text not like '%אסתר%', '★ מעל 3 ימים בלי תשלום — דבורה בשם, אסתר לא');
rollback;

drop function if exists t_enroll(text, text, text, boolean);
drop function if exists t_enroll_raw(jsonb, text);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
