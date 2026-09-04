-- 14_real_data.sql — עמידות בנתונים אמיתיים: חסרים, קצוות, מחיקות, תווים, נפח.
\set ON_ERROR_STOP on
\set BEITAR   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN   '''bbbbbbbb-0000-0000-0000-000000000002'''
\set SEASON   '''aaaaaaaa-0000-0000-0000-000000000001'''
\ir _assert.sql

\echo 'א. תלמידה בלי הורה, בלי טלפון, בלי סכום:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
insert into students (id, season_id, branch_id, full_name) values ('eeeeeeee-0000-0000-0000-000000000001', :SEASON, :BEITAR, 'תלמידה ריקה');
select assert_eq((select count(*) from v_student_overview where id = 'eeeeeeee-0000-0000-0000-000000000001'), 1, 'מופיעה ברשימת התלמידות');
select assert_eq((select balance::bigint from v_student_balance where student_id = 'eeeeeeee-0000-0000-0000-000000000001'), 0, 'יתרה 0 (לא חוב, לא זכות)');
select assert_eq((select count(*) from v_debtors where student_id = 'eeeeeeee-0000-0000-0000-000000000001'), 0, 'אינה חייבת');
select assert_true((rpc_attendance_sheet((select token from attendance_links where branch_id = :BEITAR and is_active limit 1))::text like '%תלמידה ריקה%'), 'מופיעה בגיליון הנוכחות');
-- חוב בלי טלפון: התזכורת האוטומטית מדלגת (cron-debt: if (!phone) skipped++). מי יודע?
update students set tuition_total = 1000 where id = 'eeeeeeee-0000-0000-0000-000000000001';
select assert_eq((select count(*) from v_debtors where student_id = 'eeeeeeee-0000-0000-0000-000000000001' and parent_phone is null), 1, 'חייבת בלי טלפון מופיעה ברשימת החייבות עם טלפון ריק');
rollback;

\echo 'ב. סניף בלי תלמידות, ותלמידה שעברה סניף:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
insert into branches (id, name) values ('bbbbbbbb-0000-0000-0000-000000000009', 'סניף חדש ריק');
select assert_eq((select count(*) from v_branch_pnl where branch_id = 'bbbbbbbb-0000-0000-0000-000000000009'), 1, 'סניף ריק מופיע ברווחיות');
select assert_eq((select (income_students + expenses + open_debt + active_students)::bigint from v_branch_pnl where branch_id = 'bbbbbbbb-0000-0000-0000-000000000009'), 0, 'סניף ריק: אפסים, לא null');
-- 6,000 "שווה" בין 6 סניפים פעילים = 1,000 לסניף הריק; "לפי תלמידות" (3,600) ו"ידני" (2,400) — 0.
select assert_eq((select round(sum(allocated_amount))::bigint from v_general_allocation where branch_id = 'bbbbbbbb-0000-0000-0000-000000000009'), 1000, 'סניף ריק פעיל מקבל חלק שווה בהוצאות "שווה" (1,000) ואפס ב"לפי תלמידות"');
select assert_eq((select round(sum(allocated_amount))::bigint from v_general_allocation), 12000, 'סך החלוקה נשאר 12,000 גם עם סניף ריק');
-- הוצאה כללית "לפי תלמידות" כשאין תלמידות פעילות בכלל: לאן הכסף הולך?
savepoint s1;
update students set status = 'stopped';
insert into ledger_entries (season_id, kind, scope, entry_date, category, amount, split_method) values (:SEASON, 'expense', 'general', current_date, 'בדיקה', 900, 'by_students');
-- "שווה" 6,000 + "ידני" 2,400 עדיין מחולקים; "לפי תלמידות" 3,600 + 900 — לאף אחד.
select assert_eq((select round(sum(allocated_amount))::bigint from v_general_allocation), 8400, 'אין תלמידות פעילות: 4,500 של "לפי תלמידות" לא מחולקים לאף סניף (נעלמים מרווחיות הסניפים)');
select assert_eq((select expenses_general::bigint from v_pnl_monthly where month = date_trunc('month', current_date)::date), 900, 'אבל היא כן נספרת ברווח והפסד הכללי');
rollback to s1;
-- מעבר סניף: התשלומים הולכים עם התלמידה
select income_students as before_income from v_branch_pnl where branch_id = :BEITAR \gset
select student_id as mover from v_student_balance where branch_id = :BEITAR and paid > 0 order by paid desc limit 1 \gset
select paid as mover_paid from v_student_balance where student_id = :'mover' \gset
update students set branch_id = :MODIIN where id = :'mover';
select assert_eq((select income_students::bigint from v_branch_pnl where branch_id = :BEITAR), (:'before_income')::numeric::bigint - (:'mover_paid')::numeric::bigint, 'מעבר סניף: כל התשלומים ההיסטוריים עוברים לסניף החדש (הרווחיות של הסניף הישן יורדת למפרע)');
select assert_eq((select count(*) from attendance a join lessons l on l.id = a.lesson_id where a.student_id = :'mover' and l.branch_id = :BEITAR), (select count(*) from attendance a join lessons l on l.id = a.lesson_id where a.student_id = :'mover'), 'הנוכחות ההיסטורית נשארת בשיעורי הסניף הישן');
rollback;

\echo 'ג. תשלום גדול מהחוב, ותשלום ביתרה אפס:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select student_id as deb from v_debtors where branch_id = :BEITAR order by balance desc limit 1 \gset
select balance as deb_balance from v_student_balance where student_id = :'deb' \gset
select open_debt as debt_before from v_branch_pnl where branch_id = :BEITAR \gset
insert into payments (student_id, amount, collected_by) values (:'deb', (:'deb_balance')::numeric + 500, (select t_user('owner'::user_role)));
select assert_eq((select balance::bigint from v_student_balance where student_id = :'deb'), -500, 'תשלום יתר: יתרה שלילית (זכות) — נשמר, בלי אזהרה במסד');
select assert_eq((select count(*) from v_debtors where student_id = :'deb'), 0, 'מי ששילמה יתר אינה חייבת');
select assert_eq((select open_debt::bigint from v_branch_pnl where branch_id = :BEITAR), (:'debt_before')::numeric::bigint - (:'deb_balance')::numeric::bigint,
                 '★ החוב הפתוח של הסניף יורד רק בגובה החוב — הזכות של 500 לא מקזזת חובות של אחרות');
-- תשלום ביתרה אפס
insert into payments (student_id, amount, collected_by) values (:'deb', 100, (select t_user('owner'::user_role)));
select assert_eq((select balance::bigint from v_student_balance where student_id = :'deb'), -600, 'תשלום ביתרה אפס/זכות מתקבל ומגדיל את הזכות');
rollback;

\echo 'ד. מחיקת סניף עם תלמידות והוצאות:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_no_effect('★ מחיקה קשה של סניף עם תלמידות נחסמת (מפתח זר), שום נתון לא נמחק',
  format('delete from branches where id = %L', 'bbbbbbbb-0000-0000-0000-000000000001'),
  $p$select (select count(*) from students) || '/' || (select count(*) from ledger_entries) || '/' || (select count(*) from branches) || '/' || (select count(*) from lessons)$p$);
-- מחיקה רכה (deleted_at): מה קורה לתלמידות?
update branches set deleted_at = now() where id = :BEITAR;
select assert_eq((select count(*) from v_branch_pnl where branch_id = :BEITAR), 0, 'סניף שנמחק רכה יוצא מהרווחיות');
select assert_eq((select count(*) from v_student_overview where branch_id = :BEITAR), 6, 'אבל 6 התלמידות שלו עדיין ברשימת התלמידות (יתומות: הסניף לא מוצג, הן כן)');
select assert_eq((select count(*) from v_debtors where branch_id = :BEITAR), (select count(*) from v_student_balance where branch_id = :BEITAR and balance > 0), 'והחייבות שלו עדיין בגבייה');
rollback;

\echo 'ה. שמות ארוכים ותווים מיוחדים:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select repeat('שרה-לאה ', 40) || 'כ״ץ־שפירא ז׳בוטינסקי "המנצחת" O''Brien' as longname \gset
insert into students (id, season_id, branch_id, full_name, parent_name) values ('eeeeeeee-0000-0000-0000-000000000002', :SEASON, :BEITAR, :'longname', 'אבא ״גרשיים״ ו׳גרש׳');
select assert_true((select full_name = :'longname' from students where id = 'eeeeeeee-0000-0000-0000-000000000002'), format('שם של %s תווים נשמר כמו שהוא', length(:'longname')));
select assert_eq((select count(*) from students where full_name ilike '%כ״ץ־שפירא%'), 1, 'חיפוש עם גרשיים ומקף עברי מוצא');
select assert_true((rpc_attendance_sheet((select token from attendance_links where branch_id = :BEITAR and is_active limit 1)) -> 'students') @> jsonb_build_array(jsonb_build_object('full_name', :'longname')), 'הגיליון מחזיר את השם המלא, JSON תקין');
reset role; -- הגיבוי הוא של service_role בלבד
select assert_true(rpc_backup_dump() -> 'data' -> 'public.students' @> jsonb_build_array(jsonb_build_object('full_name', :'longname')), 'הגיבוי שומר את השם תו-בתו');
rollback;

\echo 'ו. נפח: 500 תלמידות, 3,000 תשלומים, 10,000 סימוני נוכחות:'
begin;
insert into students (season_id, branch_id, full_name, parent_name, parent_phone, tuition_total, joined_on)
select :SEASON, (array[:BEITAR::uuid, :MODIIN::uuid, 'bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000005'])[1 + i % 5],
       'תלמידה ' || i, 'הורה ' || i, '05' || lpad((10000000 + i)::text, 8, '0'), 2400, current_date - (i % 200)
from generate_series(1, 500) i;
insert into payments (student_id, amount, paid_on, collected_by)
select s.id, 200, current_date - (g % 180), (select t_user('owner'::user_role))
from (select id, row_number() over () rn from students where full_name like 'תלמידה %') s, generate_series(1, 6) g;
insert into lessons (branch_id, lesson_date, status)
select b, d::date, 'reported' from unnest(array[:BEITAR::uuid, :MODIIN::uuid, 'bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000005']) b,
     generate_series(current_date - 140, current_date - 1, interval '7 days') d
on conflict do nothing;
insert into attendance (lesson_id, student_id, mark)
select l.id, s.id, (array['present','absent','late'])[1 + (s.rn + l.rn) % 3]::attendance_mark
from (select id, branch_id, row_number() over () rn from lessons where status = 'reported') l
join (select id, branch_id, row_number() over () rn from students where full_name like 'תלמידה %') s on s.branch_id = l.branch_id
on conflict do nothing;
select assert_true((select count(*) from students) >= 500, format('%s תלמידות', (select count(*) from students)));
select assert_true((select count(*) from payments) >= 3000, format('%s תשלומים', (select count(*) from payments)));
select assert_true((select count(*) from attendance) >= 10000, format('%s סימוני נוכחות', (select count(*) from attendance)));
analyze;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
create or replace function pg_temp.t_time(p_label text, p_sql text, p_max_ms int) returns void language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); n bigint; ms numeric;
begin
  -- q::text: כל עמודה מחושבת בפועל (count(*) לבד מאפשר למתכנן לדלג על עמודות שאין בהן שימוש)
  execute 'select count(q::text) from (' || p_sql || ') q' into n;
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  perform assert_true(ms <= p_max_ms, format('%s: %s שורות ב-%s ms (תקרה %s)', p_label, n, ms, p_max_ms));
end $$;
select pg_temp.t_time('מסך התלמידות (v_student_overview)', 'select * from v_student_overview', 1500);
select pg_temp.t_time('גבייה (v_debtors)', 'select * from v_debtors order by balance desc', 1500);
select pg_temp.t_time('יתרות (v_student_balance)', 'select * from v_student_balance', 1500);
select pg_temp.t_time('רווחיות סניפים (v_branch_pnl)', 'select * from v_branch_pnl', 1500);
select pg_temp.t_time('רווח והפסד חודשי (v_pnl_monthly)', 'select * from v_pnl_monthly', 1500);
select pg_temp.t_time('הנהלת חשבונות (v_students_accounting)', 'select * from v_students_accounting', 1500);
select pg_temp.t_time('רווחיות אחרי הקצאה (v_branch_profitability)', 'select * from v_branch_profitability', 1500);
select pg_temp.t_time('סיכום שיעורים (v_lesson_summary)', 'select * from v_lesson_summary', 1500);
select pg_temp.t_time('רצפי היעדרות (v_absence_streaks)', 'select * from v_absence_streaks', 1500);
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select pg_temp.t_time('מנהלת סניף: תלמידות', 'select * from v_student_overview', 1500);
select pg_temp.t_time('מנהלת סניף: גבייה', 'select * from v_debtors', 1500);
reset role;
select pg_temp.t_time('גיבוי מלא (rpc_backup_dump, service_role)', 'select rpc_backup_dump()', 5000);
select pg_temp.t_time('גיליון נוכחות ציבורי', format('select rpc_attendance_sheet(%L)', (select token from attendance_links where branch_id = :BEITAR and is_active limit 1)), 1500);
rollback;

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
