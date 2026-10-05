-- 17_enrollment.sql — הרשמה לחוגים: מבנה תשלום מאומת, דף ציבורי בטוח,
-- תלמידה ממתינה + קישור 210, פעילה אחרי תשלום, ביטול בחודש הניסיון.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

drop function if exists t_enroll(text, text, text, boolean);
create or replace function t_tok(p_branch uuid default 'bbbbbbbb-0000-0000-0000-000000000001') returns text
language sql security definer set search_path = public, pg_temp as $$ select enroll_token from branches where id = p_branch $$;

drop function if exists t_enroll(text, text, text, boolean, uuid);
create or replace function t_enroll(p_first text, p_phone text default '0521112233', p_ip text default '1.2.3.4', p_terms boolean default true,
                                    p_branch uuid default 'bbbbbbbb-0000-0000-0000-000000000001', p_track text default 'so10',
                                    p_whatsapp text default 'yes', p_photo text default 'yes') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'כהן', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', p_phone, 'email', lower(p_first) || '@example.com', 'enroll_token', t_tok(p_branch),
    'mailing_consent', true, 'terms_accepted', p_terms, 'track', p_track, 'whatsapp', p_whatsapp, 'photo', p_photo), p_ip) $$;

-- כמו הפונקציה enroll: service_role מעביר את הגוף כמו שהוא. anon אינו קורא ל-rpc_enroll ישירות (0024).
create or replace function t_enroll_raw(p jsonb, p_ip text default '1.2.3.4') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('enroll_token', t_tok(), 'track', 'so10', 'whatsapp', 'yes', 'photo', 'yes') || p, p_ip) $$;

-- רוב החבילה בודקת את מסלול הוראת הקבע (210). מוסתר עד סבב 3 — פותחים כאן, ובודקים את ההסתרה בנפרד.
update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'מבנה התשלום — מההגדרות, ומסתכם בדיוק:'
begin;
select assert_eq((f_enrollment_plan() ->> 'annual_total')::bigint, 1200, 'סך שנתי 1,200');
select assert_true(rpc_enrollment_plan() = f_enrollment_plan(), 'rpc_enrollment_plan (למסך ההגדרות) = אותו חישוב');
select assert_eq((f_enrollment_plan() ->> 'first_charge')::bigint, 210, 'חיוב ראשון 210 = 100 דמי רישום + 110');
select assert_eq((f_enrollment_plan() ->> 'tuition')::bigint, 1100, 'שכר לימוד = 1,200 − 100 דמי רישום');
select assert_eq(jsonb_array_length(f_enrollment_plan() -> 'tracks'), 5, 'חמישה מסלולים: מזומן, תשלום אחד, הוראת קבע 5/8/10');
select assert_true((select bool_and((t ->> 'first_installment')::numeric + ((t ->> 'installments')::int - 1) * (t ->> 'installment_amount')::numeric = 1100)
                    from jsonb_array_elements(f_enrollment_plan() -> 'tracks') t), '★ בכל מסלול: התשלומים מסתכמים בדיוק לשכר הלימוד (1,100)');
select assert_true((select (t ->> 'first_installment')::int = 141 and (t ->> 'installment_amount')::int = 137 and (t ->> 'first_charge')::int = 241
                    from jsonb_array_elements(f_enrollment_plan() -> 'tracks') t where t ->> 'key' = 'so8'), '★ 8 תשלומים: הראשון סופג את ההפרש — 141 ואז 7 × 137');
select assert_true((select (t ->> 'installment_amount')::int = 220 and (t ->> 'first_charge')::int = 320 from jsonb_array_elements(f_enrollment_plan() -> 'tracks') t where t ->> 'key' = 'so5'), '5 תשלומים: 220, חיוב ראשון 320');
select assert_true((select (t ->> 'first_charge')::int = 1200 from jsonb_array_elements(f_enrollment_plan() -> 'tracks') t where t ->> 'key' = 'card1'), 'תשלום אחד: 1,200');
select assert_true((select (t ->> 'first_charge')::int = 0 from jsonb_array_elements(f_enrollment_plan() -> 'tracks') t where t ->> 'key' = 'cash'), 'מזומן: אין חיוב בכרטיס');
select assert_true((select (t ->> 'first_installment')::int = 99 and (t ->> 'installment_amount')::int = 91
                    from jsonb_array_elements(f_plan_tracks('{"annual_total":1200,"registration_fee":100,"tracks":[{"key":"x","label":"12","method":"standing_order","installments":12}]}')) t),
                   '★ הכלל כללי: 12 תשלומים של 1,100 → 99 ואז 11 × 91');
select assert_no_effect('★ מבנה סניף לא תקין (דמי רישום מעל הסך) — נדחה בשמירה', $a$update branches set plan = plan || '{"registration_fee": 1300}' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$a$, $q$select plan::text from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
select assert_no_effect('מסלול בלי שם — נדחה', $a$update branches set plan = jsonb_set(plan, '{tracks,0,label}', '""') where id = 'bbbbbbbb-0000-0000-0000-000000000001'$a$, $q$select plan::text from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
select assert_no_effect('מסלול בלי מסלולים בכלל — נדחה', $a$update branches set plan = jsonb_set(plan, '{tracks}', '[]') where id = 'bbbbbbbb-0000-0000-0000-000000000001'$a$, $q$select plan::text from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$);
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

\echo 'שאלות ההרשמה ומסלולי התשלום:'
begin;
-- ★ הוראות קבע מוסתרות עד סבב 3.
update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
select assert_true((select string_agg(t ->> 'key', ',' order by t ->> 'key') from jsonb_array_elements(rpc_enrollment_public(t_tok()) -> 'tracks') t) = 'card1,cash',
                   '★ לפני סבב 3 ההורה רואה רק מזומן ותשלום אחד');
select assert_true((t_enroll('עדי', '0521230001', '11.0.0.1', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'so10') ->> 'error') like '%אופן תשלום%', '★ מסלול הוראת קבע מוסתר — נדחה גם אם נשלח');
select assert_eq(jsonb_array_length(f_visible_tracks((select plan from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'))), 2, 'f_visible_tracks: שניים גלויים');
select assert_eq(jsonb_array_length(f_default_tracks()), 5, 'f_default_tracks: חמשת המסלולים לסניף חדש');

-- מזומן: אין קישור, ממתינה, פעילה כשנרשם תשלום.
select assert_true((t_enroll('מזל', '0521230002', '11.0.0.2', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'cash') ->> 'method') = 'cash', 'הרשמה במזומן');
select assert_eq((select count(*) from payment_links l join students s on s.id = l.student_id where s.first_name = 'מזל'), 0, '★ מזומן: לא נוצר קישור תשלום');
select assert_true((select status = 'pending' and payment_track ->> 'key' = 'cash' and installments_total = 1 from students where first_name = 'מזל'), '★ ממתינה, והמסלול שבחרה נשמר אצלה');
insert into payments (student_id, branch_id, paid_on, amount, method, source) select id, branch_id, current_date, 1200, 'cash', 'manual' from students where first_name = 'מזל';
select assert_true((select status = 'active' from students where first_name = 'מזל'), '★ הבעלים רשמה את המזומן — פעילה');

-- תשלום אחד: קישור על הסכום המלא.
select assert_true((t_enroll('אביטל', '0521230003', '11.0.0.3', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'card1') ->> 'amount')::numeric = 1200, 'תשלום אחד');
select assert_eq((select amount::bigint from payment_links l join students s on s.id = l.student_id where s.first_name = 'אביטל'), 1200, '★ תשלום אחד: קישור על 1,200');

-- וואטסאפ "לא": מסומנת, והתזכורות אליה לא יוצאות — מבוטלות עם הסבר.
select t_enroll('ליבי', '0521230004', '11.0.0.4', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'card1', 'no');
select assert_true((select whatsapp_opt_in = false from students where first_name = 'ליבי'), '★ ענתה "לא" — מסומנת בכרטיס');
select assert_true((select r.status = 'cancelled' and r.error like '%דרוש קשר אחר%' from reminders r join students s on s.id = r.student_id where s.first_name = 'ליבי'),
                   '★ הודעת הקישור לא יוצאת בוואטסאפ — מבוטלת עם "דרוש קשר אחר"');
insert into reminders (kind, student_id, branch_id, to_phone, body, scheduled_at)
  select 'debt', id, branch_id, parent_phone, 'תזכורת חוב', now() from students where first_name = 'ליבי';
select assert_eq((select count(*) from reminders r join students s on s.id = r.student_id where s.first_name = 'ליבי' and r.status = 'scheduled'), 0, '★ גם תזכורת חוב מאוחרת — לא יוצאת');
select assert_true((select r.status = 'scheduled' from reminders r join students s on s.id = r.student_id where s.first_name = 'אביטל' limit 1), 'מי שענתה "כן" — התזכורת יוצאת כרגיל');

-- אישור צילום: התשובה = השדה הקיים, והנוסח נשמר.
select assert_true((select photo_consent and photo_consent_text like 'אישור לצילום%' from students where first_name = 'אביטל'), '★ אישור צילום "כן" + הנוסח המדויק נשמר אצלה');
select t_enroll('נוי', '0521230005', '11.0.0.5', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'card1', 'yes', 'no');
select assert_true((select photo_consent = false from students where first_name = 'נוי'), 'אישור צילום "לא"');
select assert_no_effect('★ "לא" לצילום — חוסם צירוף להפקה', $a$insert into production_cast (production_id, student_id) select (select id from productions limit 1), id from students where first_name = 'נוי'$a$, 'select count(*)::text from production_cast');

-- חובה כשמוצגות.
select assert_true((t_enroll('תהל', '0521230006', '11.0.0.6', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'card1', '') ->> 'error') like '%וואטסאפ%', 'בלי תשובה לוואטסאפ — נדחה');
select assert_true((t_enroll('תהל', '0521230006', '11.0.0.6', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'card1', 'yes', 'maybe') ->> 'error') like '%צילום%', 'תשובה לא חוקית לצילום — נדחה');

-- ★ מתגים: שאלה מוסתרת לא מופיעה ולא נלקחת מהבקשה.
update branches set form_options = '{"ask_whatsapp": false, "ask_photo": false, "ask_track": false}' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert_true(rpc_enrollment_public(t_tok()) -> 'questions' = '{"photo": false, "track": false, "whatsapp": false}'::jsonb
                   and rpc_enrollment_public(t_tok()) -> 'photo_consent_text' = 'null'::jsonb, 'הדף יודע אילו שאלות מוסתרות');
select assert_true((t_enroll('הודיה', '0521230007', '11.0.0.7', true, 'bbbbbbbb-0000-0000-0000-000000000001', 'cash', 'no', 'yes') ->> 'ok')::boolean, 'הרשמה בלי השאלות');
select assert_true((select whatsapp_opt_in is null and photo_consent = false and photo_consent_text is null and payment_track ->> 'key' = 'cash' from students where first_name = 'הודיה'),
                   '★ שאלה מוסתרת: התשובה מהבקשה לא נשמרת; מסלול — הראשון שמוצג');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq(jsonb_array_length(rpc_branch_tracks('bbbbbbbb-0000-0000-0000-000000000001')), 5, 'rpc_branch_tracks: הבעלים רואה את כל המסלולים, כולל הוראות קבע');
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('מנהלת לא רואה מסלולים של סניף אחר', $a$select rpc_branch_tracks('bbbbbbbb-0000-0000-0000-000000000002')$a$, 'select 1::text');
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

drop function if exists t_enroll(text, text, text, boolean, uuid, text, text, text);
drop function if exists t_tok(uuid);
update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function if exists t_enroll_raw(jsonb, text);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
