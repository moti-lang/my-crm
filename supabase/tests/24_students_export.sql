-- 24_students_export.sql — ייצוא תלמידות (0039): מי מקבלת אילו שורות ואילו שדות.
\set ON_ERROR_STOP on
\set SEASON '''aaaaaaaa-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN '''bbbbbbbb-0000-0000-0000-000000000002'''
\set FULL '''eeeeeeee-0000-0000-0000-00000000e001'''
\ir _assert.sql

begin;
-- תלמידה עם כל הפרטים, ותלמידה מחוקה.
insert into students (id, season_id, branch_id, full_name, birth_date, grade, school, group_name, parent_name, parent_phone, alt_phone,
                      email, address, status, joined_on, tuition_total, discount, registration_fee, installments_total,
                      photo_consent, mailing_consent, whatsapp_opt_in, terms_accepted_at, notes, payment_track)
values (:FULL, :SEASON, :BEITAR, 'נועה ייצוא', current_date - interval '9 years 2 days', 'ג', 'בית יעקב', 'קבוצה א', 'רחל ייצוא',
        '972501112233', '972527778899', 'rachel@example.com', 'רחוב הנביאים 5, ביתר', 'active', '2026-09-01', 2000, 100, 150, 10,
        true, false, true, '2026-09-01 08:30+03', 'הערה בעברית', '{"key":"so10","label":"הוראת קבע ב-10 תשלומים","method":"standing_order"}');
insert into payments (student_id, paid_on, amount, method, source) values (:FULL, '2026-09-01', 350, 'cash', 'manual'), (:FULL, '2026-10-01', 200, 'cash', 'manual');
insert into students (season_id, branch_id, full_name, parent_phone, status, deleted_at)
values (:SEASON, :BEITAR, 'מחוקה ייצוא', '972509990000', 'active', now());

\echo 'בעלים:'
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select count(*) from rpc_students_export()), (select count(*) from students where deleted_at is null), 'כל התלמידות שלא נמחקו');
select assert_eq((select count(*) from rpc_students_export() r where r ->> 'full_name' = 'מחוקה ייצוא'), 0, '★ תלמידה מחוקה לא מיוצאת');
select assert_true((select r ->> 'parent_phone' = '972501112233' and r ->> 'alt_phone' = '972527778899' and r ->> 'email' = 'rachel@example.com'
                       and r ->> 'address' = 'רחוב הנביאים 5, ביתר' and not (r ->> 'contact_hidden')::boolean
                    from rpc_students_export() r where r ->> 'id' = :FULL), 'כל פרטי הקשר');
select assert_true((select (r ->> 'age')::int = 9 and r ->> 'birth_date' = to_char(current_date - interval '9 years 2 days', 'YYYY-MM-DD')
                    from rpc_students_export() r where r ->> 'id' = :FULL), 'גיל מחושב מתאריך הלידה');
select assert_true((select (r ->> 'paid')::numeric = 550 and (r ->> 'balance')::numeric = 1500 and (r ->> 'payments_count')::int = 2
                       and (r ->> 'installments_planned')::int = 10 and r ->> 'payment_track_label' = 'הוראת קבע ב-10 תשלומים'
                    from rpc_students_export() r where r ->> 'id' = :FULL), 'שולם, יתרה (2000−100+150−550), 2 מתוך 10, מסלול');
select assert_true((select (r ->> 'photo_consent')::boolean and not (r ->> 'mailing_consent')::boolean and (r ->> 'whatsapp_opt_in')::boolean
                       and r ->> 'school' = 'בית יעקב' and r ->> 'group_name' = 'קבוצה א' and r ->> 'notes' = 'הערה בעברית'
                    from rpc_students_export() r where r ->> 'id' = :FULL), 'הסכמות, בית ספר, קבוצה, הערות');
select assert_true((select count(*) > 0 and bool_and(r ->> 'branch_id' = :MODIIN) from rpc_students_export(:MODIIN) r), 'סינון לפי סניף (מסך הסניף): רק הסניף, ולא ריק');

\echo 'מנהלת סניף:'
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_true((select count(*) > 0 from rpc_students_export()), 'מנהלת סניף מקבלת את התלמידות שלה');
select assert_eq((select count(*) from rpc_students_export() r where (r ->> 'branch_id')::uuid not in (select my_branches())), 0,
  '★ מנהלת סניף מייצאת רק את הסניפים שלה');
select assert_eq((select count(*) from rpc_students_export(:MODIIN)), 0, '★ גם כשמבקשת סניף אחר במפורש — כלום');
select assert_true((select r ->> 'parent_phone' = '972501112233' from rpc_students_export() r where r ->> 'id' = :FULL), 'בסניף שלה — עם הטלפון');

\echo 'רואת חשבון:'
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_eq((select count(*) from rpc_students_export()), (select count(*) from v_students_accounting), 'רואת חשבון מקבלת את כל התלמידות');
select assert_eq((select count(*) from rpc_students_export() r where r ?| array['parent_phone', 'alt_phone', 'address', 'email']), 0,
  '★ רואת חשבון: אין טלפון, טלפון נוסף, כתובת או מייל — השדות לא יוצאים מהמסד');
select assert_eq((select count(*) from rpc_students_export() r where r::text ~ '(9725[0-9]{8}|rachel@|הנביאים)'), 0,
  '★ ואף ערך שלהם לא מופיע בשום מקום בשורה');
select assert_true((select (r ->> 'contact_hidden')::boolean and (r ->> 'balance')::numeric = 1500 and r ->> 'parent_name' = 'רחל ייצוא'
                    from rpc_students_export() r where r ->> 'id' = :FULL), 'אבל כן הכספים ושם ההורה');

\echo 'בלי תפקיד:'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
select assert_eq((select count(*) from rpc_students_export()), 0, '★ משתמשת בלי פרופיל פעיל — כלום');
reset role;
select assert_no_execute('anon', 'rpc_students_export(uuid)');
rollback;
\echo '  כל בדיקות ייצוא התלמידות עברו'
