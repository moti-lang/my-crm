-- 17_enrollment.sql — הרשמה לחוגים: מבנה תשלום מאומת, דף ציבורי בטוח,
-- תלמידה ממתינה + קישור 210, פעילה אחרי תשלום, ביטול בחודש הניסיון.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

drop function if exists t_enroll(text, text, text, boolean);
create or replace function t_tok(p_branch uuid default 'bbbbbbbb-0000-0000-0000-000000000001') returns text
language sql security definer set search_path = public, pg_temp as $$ select enroll_token from branches where id = p_branch $$;

create or replace function t_enroll(p_first text, p_phone text default '0521112233', p_ip text default '1.2.3.4', p_terms boolean default true,
                                    p_branch uuid default 'bbbbbbbb-0000-0000-0000-000000000001') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'כהן', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', p_phone, 'email', lower(p_first) || '@example.com', 'enroll_token', t_tok(p_branch),
    'mailing_consent', true, 'terms_accepted', p_terms), p_ip) $$;

-- כמו הפונקציה enroll: service_role מעביר את הגוף כמו שהוא. anon אינו קורא ל-rpc_enroll ישירות (0024).
create or replace function t_enroll_raw(p jsonb, p_ip text default '1.2.3.4') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(case when p ? 'enroll_token' then p else p || jsonb_build_object('enroll_token', t_tok()) end, p_ip) $$;

\echo 'מבנה התשלום — מההגדרות, ומסתכם בדיוק:'
begin;
select assert_eq((f_enrollment_plan() ->> 'annual_total')::bigint, 1200, 'סך שנתי 1,200');
select assert_true(rpc_enrollment_plan() = f_enrollment_plan(), 'rpc_enrollment_plan (למסך ההגדרות) = אותו חישוב');
select assert_eq((f_enrollment_plan() ->> 'first_charge')::bigint, 210, 'חיוב ראשון 210 = 100 דמי רישום + 110');
select assert_eq((f_enrollment_plan() ->> 'tuition')::bigint, 1100, 'שכר לימוד = 1,200 − 100 דמי רישום');
select assert_true((f_enrollment_plan() ->> 'registration_fee')::numeric + (f_enrollment_plan() ->> 'installments')::int * (f_enrollment_plan() ->> 'installment_amount')::numeric = 1200, '★ 100 + 10 × 110 = 1,200 בדיוק');
select assert_no_effect('★ מבנה סניף שלא מסתכם — נדחה בשמירה', $a$update branches set plan = plan || '{"installment_amount": 100, "first_charge": 200}' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$a$, $q$select plan::text from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
rollback;

\echo 'הדף הציבורי:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select assert_true(rpc_enrollment_public(t_tok()) ->> 'program_name' = 'דרמחול - החוגים של הניה', 'שם החוג מההגדרות');
select assert_true(length(rpc_enrollment_public(t_tok()) ->> 'terms') > 500 and (rpc_enrollment_public(t_tok()) ->> 'terms') like '%מדיניות ביטולים%', 'התקנון המלא של הסניף מוצג');
select assert_true(rpc_enrollment_public(t_tok()) #>> '{branch,name}' = 'ביתר עילית', '★ הקישור קובע את הסניף');
select assert_true((rpc_enrollment_public() ->> 'ok')::boolean = false and (rpc_enrollment_public() ->> 'error') like '%קישור%', '★ בלי קישור, כשיש כמה סניפים — אין בחירת סניף, מפנה לקישור');
select assert_true((rpc_enrollment_public('deadbeef') ->> 'ok')::boolean = false, 'קישור לא קיים — נדחה');
select assert_true(rpc_enrollment_public(t_tok())::text !~ '(972|parent_phone|tuition_total|default_tuition|supervisor|enroll_token|capacity)', '★ הדף לא חושף טלפונים או נתונים פנימיים');
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
select assert_eq((select count(*) from students where first_name = 'רבקה' and last_name = 'כהן' and source = 'enrollment' and status = 'pending' and enrolled_at > now() - interval '1 minute'), 1, '★ תלמידה ממתינה, מקור enrollment');
select assert_true((select tuition_total = 1100 and registration_fee = 100 and installments_total = 10 and terms_accepted_at is not null and mailing_consent and trial_started_on = current_date and parent_phone = '972521112233' from students where first_name = 'רבקה' and last_name = 'כהן' and source = 'enrollment'), '★ מבנה התשלום הוחל; אישור התקנון נשמר עם זמן; חודש הניסיון התחיל היום');
select assert_eq((select amount::bigint from payment_links where purpose = 'enrollment' and created_at > now() - interval '1 minute' order by created_at desc limit 1), 210, '★ קישור תשלום אוטומטי על 210');
select assert_eq((select count(*) from reminders where kind = 'payment_link' and body like '%210%' and body like '%/pay/%' and created_at > now() - interval '1 minute'), 1, '★ ההודעה עם הקישור בתור הוואטסאפ');
select assert_true((t_enroll('רבקה', '0521112233', '1.2.3.4') ->> 'ok')::boolean = false, 'אותה תלמידה פעמיים — נדחית');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select balance::bigint from v_student_balance where full_name = 'רבקה כהן' and student_id in (select id from students where source = 'enrollment')), 1200, 'היתרה: 1,200 (דמי רישום + שכר לימוד)');
select assert_eq((select count(*) from v_enrolled_unpaid where full_name = 'רבקה כהן' and enrolled_at > now() - interval '1 minute'), 1, 'מופיעה ב"נרשמו ולא שילמו"');
select assert_eq((select count(*) from v_mailing_list where full_name = 'רבקה כהן' and enrolled_at > now() - interval '1 minute'), 1, '★ הבעלים רואה אותה ברשימת התפוצה (אישרה)');
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
select assert_true((t_enroll_raw('{"first_name":"שרה","last_name":"לוי","grade":"ד","school":"s","phone":"0521112233","email":"a@b.co","enroll_token":"00000000000000000000000000000000","terms_accepted":true}') ->> 'error') like '%קישור%', 'קישור הרשמה לא קיים — נדחה');
select assert_true((t_enroll_raw('{"first_name":"שרה","last_name":"לוי","grade":"ד","school":"s","phone":"0521112233","email":"a@b.co","branch_id":"bbbbbbbb-0000-0000-0000-000000000002","enroll_token":"","terms_accepted":true}') ->> 'error') like '%קישור%', '★ branch_id מהדפדפן לא קובע סניף');
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
select assert_eq((select count(*) from system_alerts where kind = 'enrollment_flood' and created_at > now() - interval '1 minute'), 2, 'התראה לבעלים על הצפה — אחת לטלפון, אחת ל-IP');
rollback;

\echo 'תשלום נקלט → פעילה; כרטיס התלמידה:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('מרים');
reset role;
select assert_true((rpc_record_sumit_payment((select external_identifier from payment_links where purpose = 'enrollment' and created_at > now() - interval '1 minute' order by created_at desc limit 1), 'S-1', 210, now(), 'D-1') ->> 'ok')::boolean, 'התשלום נרשם');
select assert_eq((select count(*) from students where first_name = 'מרים' and status = 'active'), 1, '★ אחרי החיוב הראשון — פעילה אוטומטית');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_installment_progress((select id from students where first_name = 'מרים' and last_name = 'כהן' and source = 'enrollment')) ->> 'installments_paid')::int = 1, '★ הכרטיס: תשלום 1 מתוך 10');
select assert_true((rpc_installment_progress((select id from students where first_name = 'מרים' and last_name = 'כהן' and source = 'enrollment')) ->> 'registration_paid')::numeric = 100 and (rpc_installment_progress((select id from students where first_name = 'מרים' and last_name = 'כהן' and source = 'enrollment')) ->> 'balance')::numeric = 990, 'דמי רישום שולמו; נותרו 990');
select assert_eq((select registration_paid::bigint from v_student_balance where full_name = 'מרים כהן' and student_id in (select id from students where source = 'enrollment')), 100, 'בדוחות: דמי רישום נפרדים משכר הלימוד');
select assert_eq((select tuition_paid::bigint from v_student_balance where full_name = 'מרים כהן' and student_id in (select id from students where source = 'enrollment')), 110, 'ו-110 לשכר הלימוד');
select assert_eq((select count(*) from v_enrolled_unpaid where full_name = 'מרים כהן' and enrolled_at > now() - interval '1 minute'), 0, 'יצאה מ"נרשמו ולא שילמו"');
rollback;

\echo 'ביטול בחודש הניסיון:'
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('נעמי');
reset role;
select rpc_record_sumit_payment((select external_identifier from payment_links where purpose = 'enrollment' and created_at > now() - interval '1 minute' order by created_at desc limit 1), 'S-2', 210, now(), 'D-2');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('★ מנהלת סניף לא מבטלת', format('select rpc_cancel_enrollment(%L)', (select id from students where first_name = 'נעמי' and last_name = 'כהן' and source = 'enrollment')), 'select count(*)::text from payments');
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((rpc_cancel_enrollment((select id from students where first_name = 'נעמי' and last_name = 'כהן' and source = 'enrollment')) ->> 'refund')::bigint, 75, '★ ביטול בתוך החודש — זיכוי 75');
select assert_true((select status = 'stopped' and cancelled_at is not null and refund_amount = 75 from students where first_name = 'נעמי' and last_name = 'כהן' and source = 'enrollment'), 'הופסקה, עם תיעוד');
select assert_eq((select count(*) from payments where source = 'refund' and amount = -75 and created_at > now() - interval '1 minute'), 1, 'הזיכוי נרשם כתשלום שלילי');
select assert_eq((select count(*) from v_mailing_list where full_name = 'נעמי כהן' and enrolled_at > now() - interval '1 minute'), 1, 'נשארת ברשימת התפוצה (אישרה)');
rollback;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select t_enroll('חנה');
reset role;
update students set trial_started_on = current_date - 31 where first_name = 'חנה';
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_no_effect('★ אחרי חודש הניסיון — הביטול חסום', format('select rpc_cancel_enrollment(%L)', (select id from students where first_name = 'חנה' and last_name = 'כהן' and source = 'enrollment')), $p$select status::text from students where first_name = 'חנה' and last_name = 'כהן' and source = 'enrollment'$p$);
do $$ begin
  perform rpc_cancel_enrollment((select id from students where first_name = 'חנה' and last_name = 'כהן' and source = 'enrollment'));
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
select assert_true((rpc_enrollment_digest(current_date - 7) ->> 'enrolled')::bigint >= 2, 'נרשמו השבוע: לפחות 2');
select assert_true((rpc_enrollment_digest(current_date - 7) ->> 'paid')::bigint >= 1, 'מהן שילמו: לפחות 1');
select assert_true((rpc_enrollment_digest(current_date) -> 'overdue')::text like '%דבורה כהן%' and (rpc_enrollment_digest(current_date) -> 'overdue')::text not like '%אסתר%', '★ מעל 3 ימים בלי תשלום — דבורה בשם, אסתר לא');
rollback;

\echo 'סניף = יחידה עצמאית:'
begin;
-- סניף חדש: עותק של ברירת המחדל, קישור ייחודי.
insert into branches (id, name, city) values ('bbbbbbbb-0000-0000-0000-0000000000f1', 'בדיקה א', 'עיר');
select assert_true((select plan = (select value from settings where key = 'enrollment_plan') and terms = (select value #>> '{}' from settings where key = 'enrollment_terms')
                    from branches where id = 'bbbbbbbb-0000-0000-0000-0000000000f1'), '★ סניף חדש מקבל עותק של התקנון ומבנה התשלום הנוכחיים');
select assert_true(t_tok('bbbbbbbb-0000-0000-0000-0000000000f1') <> t_tok() and length(t_tok('bbbbbbbb-0000-0000-0000-0000000000f1')) >= 32, '★ קישור הרשמה ייחודי לכל סניף');
-- מחיר אחר לסניף אחד: 1,500 = 150 + 10 × 135. הסניף השני לא זז.
update branches set plan = plan || '{"annual_total":1500,"registration_fee":150,"installment_amount":135,"first_charge":285,"cancel_refund":100}',
                    terms = 'תקנון בדיקה א'
 where id = 'bbbbbbbb-0000-0000-0000-0000000000f1';
select assert_eq((select (plan ->> 'annual_total')::bigint from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 1200, '★ שינוי מחיר בסניף אחד לא נוגע בסניף אחר');
select assert_true((select terms like '%מדיניות ביטולים%' from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'גם התקנון של הסניף האחר לא זז');
select assert_true(rpc_enrollment_public(t_tok('bbbbbbbb-0000-0000-0000-0000000000f1')) ->> 'terms' = 'תקנון בדיקה א'
               and (rpc_enrollment_public(t_tok('bbbbbbbb-0000-0000-0000-0000000000f1')) #>> '{plan,first_charge}')::numeric = 285, '★ הדף מציג את התקנון והמחיר של הסניף שבקישור');
select assert_true((t_enroll('תמר', '0524444444', '3.3.3.3', true, 'bbbbbbbb-0000-0000-0000-0000000000f1') ->> 'ok')::boolean, 'הרשמה לסניף א');
select assert_true((select tuition_total = 1350 and registration_fee = 150 and terms_text = 'תקנון בדיקה א' and (plan_snapshot ->> 'installment_amount')::numeric = 135
                    from students where first_name = 'תמר' and branch_id = 'bbbbbbbb-0000-0000-0000-0000000000f1'), '★ התלמידה מקבלת את תנאי הסניף; הנוסח המדויק שאישרה נשמר');
select assert_eq((select amount::bigint from payment_links l join students s on s.id = l.student_id where s.first_name = 'תמר'), 285, '★ קישור החיוב הראשון לפי מבנה הסניף');
select assert_true((t_enroll('רחל', '0525555555', '4.4.4.4') ->> 'ok')::boolean, 'הרשמה לביתר');
select assert_true((select tuition_total = 1100 and registration_fee = 100 from students where first_name = 'רחל' and last_name = 'כהן'), 'בביתר — התנאים של ביתר');
-- ★ שינוי מחיר אחרי ההרשמה — לא משנה למי שכבר נרשמה.
update branches set plan = plan || '{"annual_total":1600,"registration_fee":150,"installment_amount":145,"first_charge":295,"cancel_refund":0}', terms = 'תקנון חדש'
 where id = 'bbbbbbbb-0000-0000-0000-0000000000f1';
select assert_true((select tuition_total = 1350 and terms_text = 'תקנון בדיקה א' from students where first_name = 'תמר'), '★ תלמידה קיימת נשארת על התנאים שלה');
-- הדוחות: מחירים שונים בסניפים שונים.
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select due::bigint from v_student_balance b join students s on s.id = b.student_id where s.first_name = 'תמר'), 1500, 'בדוחות: היתרה של סניף א לפי 1,500');
select assert_eq((select due::bigint from v_student_balance b join students s on s.id = b.student_id where s.first_name = 'רחל' and s.last_name = 'כהן'), 1200, 'ושל ביתר לפי 1,200');
-- ביטול לפי התנאים שאישרה (החזר 100), לא לפי המבנה החדש (0).
select rpc_record_sumit_payment((select external_identifier from payment_links l join students s on s.id = l.student_id where s.first_name = 'תמר'), 'S-9', 285, now(), null);
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((rpc_cancel_enrollment((select id from students where first_name = 'תמר')) ->> 'refund')::bigint, 100, '★ הביטול לפי התנאים שהתלמידה אישרה');
reset role;
rollback;

begin;
-- פתיחה/סגירה ומכסה.
update branches set enrollment_open = false where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert_true((rpc_enrollment_public(t_tok()) ->> 'open')::boolean = false and rpc_enrollment_public(t_tok()) ->> 'closed_reason' = 'closed', 'הדף יודע שההרשמה סגורה');
select assert_true((t_enroll('יעל', '0526666666', '5.5.5.5') ->> 'error') like '%סגורה%', '★ הרשמה לסניף סגור — נדחית');
update branches set enrollment_open = true,
                    capacity = (select count(*) from students where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and deleted_at is null and cancelled_at is null and status in ('active','pending')
                                  and season_id = (select id from seasons where is_current)) + 1
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert_true((t_enroll('יעל', '0526666666', '5.5.5.5') ->> 'ok')::boolean, 'מקום אחרון — עוברת');
select assert_true((t_enroll('נחמה', '0527777777', '6.6.6.6') ->> 'error') like '%מלאה%', '★ המכסה התמלאה — נסגר לבד');
select assert_true(rpc_enrollment_public(t_tok()) ->> 'closed_reason' = 'full', 'הדף מראה "מלא"');
rollback;

begin;
-- סניף פעיל יחיד: /enroll בלי קישור עובד (תאימות לקישור הכללי).
update branches set is_active = false where id <> 'bbbbbbbb-0000-0000-0000-000000000001';
select assert_true((rpc_enrollment_public() ->> 'ok')::boolean and rpc_enrollment_public() #>> '{branch,name}' = 'ביתר עילית', 'סניף פעיל יחיד — הקישור הכללי מוביל אליו');
select assert_true((t_enroll_raw('{"first_name":"שושנה","last_name":"כהן","grade":"ד","school":"s","phone":"0528888888","email":"a@b.co","enroll_token":"","terms_accepted":true}') ->> 'ok')::boolean, 'והרשמה בלי טוקן עוברת');
rollback;

\echo 'הפונקציות של הסניף, ישירות:'
begin;
select assert_eq((f_plan_check('{"annual_total":1500,"registration_fee":150,"installments":10,"installment_amount":135}') ->> 'first_charge')::bigint, 285, 'f_plan_check: מחשב חיוב ראשון ושכר לימוד');
select assert_no_effect('f_plan_check: מבנה שלא מסתכם — זורק', $a$select f_plan_check('{"annual_total":1500,"registration_fee":150,"installments":10,"installment_amount":100}')$a$, 'select 1::text');
select assert_true(f_enroll_branch(t_tok()) = 'bbbbbbbb-0000-0000-0000-000000000001'::uuid and f_enroll_branch('nope') is null, 'f_enroll_branch: טוקן → סניף; טוקן זר → כלום');
select assert_true((f_branch_enrollment_state('bbbbbbbb-0000-0000-0000-000000000001') ->> 'open')::boolean, 'f_branch_enrollment_state: סניף פעיל ופתוח');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_branch_enrollment_state('bbbbbbbb-0000-0000-0000-000000000001') ->> 'taken')::int >= 0, 'rpc_branch_enrollment_state: הבעלים רואה כמה נרשמו');
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('★ מנהלת לא רואה מצב הרשמה של סניף אחר', $a$select rpc_branch_enrollment_state('bbbbbbbb-0000-0000-0000-000000000002')$a$, 'select 1::text');
select assert_no_execute('anon', 'rpc_branch_enrollment_state(uuid)');
select assert_no_execute('authenticated', 'f_branch_enrollment_state(uuid)');
rollback;

\echo 'הוספת תלמידה ידנית:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_create_student(jsonb_build_object('branch_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'first_name', 'דינה', 'last_name', 'ידנית',
                     'grade', 'ה', 'parent_name', 'אמא', 'parent_phone', '050-1234567', 'email', 'd@example.com')) ->> 'ok')::boolean, 'הבעלים מוסיפה תלמידה');
reset role;
select assert_true((select status = 'active' and source = 'manual' and tuition_total = 1100 and registration_fee = 100 and plan_snapshot is not null and terms_text is not null and parent_phone = '972501234567'
                    from students where full_name = 'דינה ידנית'), '★ תנאי הסניף נשמרים אצלה, כמו בהרשמה');
select assert_eq((select count(*) from payment_links l join students s on s.id = l.student_id where s.full_name = 'דינה ידנית'), 0, 'בלי קישור תשלום אוטומטי');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_no_effect('כפילות — נדחית', $a$select rpc_create_student('{"branch_id":"bbbbbbbb-0000-0000-0000-000000000001","first_name":"דינה","last_name":"ידנית"}')$a$, 'select count(*)::text from students');
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('★ מנהלת לא מוסיפה לסניף שאינו שלה', $a$select rpc_create_student('{"branch_id":"bbbbbbbb-0000-0000-0000-000000000002","first_name":"זרה","last_name":"בסניף"}')$a$, 'select count(*)::text from students');
select assert_true((rpc_create_student('{"branch_id":"bbbbbbbb-0000-0000-0000-000000000001","first_name":"של","last_name":"המנהלת"}') ->> 'ok')::boolean, 'מנהלת מוסיפה לסניף שלה');
rollback;

drop function if exists t_enroll(text, text, text, boolean, uuid);
drop function if exists t_tok(uuid);
drop function if exists t_enroll_raw(jsonb, text);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
