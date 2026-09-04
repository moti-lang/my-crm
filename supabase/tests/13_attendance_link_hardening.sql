-- 13_attendance_link_hardening.sql — הדלת הפתוחה היחידה: תפוגה והצפה.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

-- קישור, שיעור של היום, ותלמידה — כמו ב-06, כדי שהדיווח יעבור.
-- הפונקציות הן security definer; שמי רשאי להריץ אותן (anon) נבדק ב-06.
-- כאן נבדקת ההתנהגות, ולכן הקריאות ישירות.
create or replace function t_setup_link() returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text;
begin
  update attendance_links set is_active = false where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into attendance_links (branch_id, token) values ('bbbbbbbb-0000-0000-0000-000000000001', v_token);
  insert into lessons (branch_id, lesson_date, status)
  select 'bbbbbbbb-0000-0000-0000-000000000001', current_date, 'pending'
  where not exists (select 1 from lessons where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and lesson_date = current_date);
  return v_token;
end $$;

\echo 'תפוגה אחרי 90 יום:'
begin;
select t_setup_link() as tok \gset
select assert_true((rpc_attendance_sheet(:'tok') ->> 'ok')::boolean, 'קישור טרי עובד');
update attendance_links set created_at = now() - interval '91 days', last_used_at = null where token = :'tok';
select assert_true((select not f_attendance_link_alive(l) from attendance_links l where token = :'tok'), 'f_attendance_link_alive: 91 יום בלי שימוש — מת');
select assert_true((rpc_attendance_sheet(:'tok') ->> 'ok')::boolean = false
                   and rpc_attendance_sheet(:'tok') ->> 'error' like '%פג תוקף%',
                   '★ 91 יום בלי שימוש — הגיליון מסרב');
select assert_no_effect(
  '★ 91 יום בלי שימוש — הדיווח לא נשמר',
  format($a$select rpc_attendance_submit(%L, (select id from lessons where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and lesson_date = current_date limit 1),
          (select jsonb_agg(jsonb_build_object('student_id', id, 'mark', 'present')) from students where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and deleted_at is null limit 3))$a$, :'tok'),
  $p$select count(*)::text from public.attendance a join public.lessons l on l.id = a.lesson_id where l.lesson_date = current_date$p$);
-- שימוש לפני 89 יום: עדיין חי. השימוש עצמו מרענן את השעון.
update attendance_links set created_at = now() - interval '200 days', last_used_at = now() - interval '89 days' where token = :'tok';
select assert_true((select f_attendance_link_alive(l) from attendance_links l where token = :'tok'), 'f_attendance_link_alive: 89 יום מאז שימוש — חי');
select assert_true((rpc_attendance_sheet(:'tok') ->> 'ok')::boolean, '89 יום מאז השימוש האחרון — עדיין חי');
select assert_true((select last_used_at > now() - interval '1 minute' from attendance_links where token = :'tok'),
                   'השימוש מרענן את השעון');
rollback;

\echo 'התראת הצפה:'
begin;
select t_setup_link() as tok \gset
select id as lesson from lessons where branch_id = :BEITAR and lesson_date = current_date limit 1 \gset
select (select jsonb_agg(jsonb_build_object('student_id', id, 'mark', 'present')) from students where branch_id = :BEITAR and deleted_at is null limit 2)::text as marks \gset
-- 30 דיווחים: אין התראה
-- הפונקציה בביטוי הנבחר, לא ב-lateral: אחרת המתכנן מריץ אותה פעם אחת.
select count(rpc_attendance_submit(:'tok', :'lesson', :'marks'::jsonb)) from generate_series(1, 30);
select assert_eq((select count(*) from system_alerts where kind = 'attendance_link_flood'), 0, '30 דיווחים בשעה — עדיין בלי התראה');
select assert_true((rpc_attendance_submit(:'tok', :'lesson', :'marks'::jsonb) ->> 'ok')::boolean, 'הדיווח ה-31 עדיין נשמר (לא חוסמים את האחראית)');
select assert_eq((select count(*) from system_alerts where kind = 'attendance_link_flood'), 1, '★ הדיווח ה-31 — התראה לבעלים');
select assert_true((select body like '%ביתר עילית%' from system_alerts where kind = 'attendance_link_flood'), 'ההתראה מציינת את הסניף');
select count(rpc_attendance_submit(:'tok', :'lesson', :'marks'::jsonb)) from generate_series(1, 10);
select assert_eq((select count(*) from system_alerts where kind = 'attendance_link_flood'), 1, '★ עוד 10 דיווחים — עדיין התראה אחת (לא הצפה של התראות)');
rollback;

\echo 'מה שהקישור מחזיר:'
begin;
select t_setup_link() as tok \gset
select assert_true((rpc_attendance_sheet(:'tok'))::text !~ '(972|parent_phone|balance|tuition|address|email)',
                   '★ הגיליון אינו מכיל טלפון, כתובת, אימייל או סכום');
select assert_eq((select count(*) from jsonb_object_keys(rpc_attendance_sheet(:'tok') -> 'students' -> 0)), 3,
                 'לכל תלמידה בדיוק שלושה שדות: מזהה, שם, סימון');
rollback;

drop function if exists t_setup_link();
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות הקשחת קישור הנוכחות עברו'
\echo '─────────────────────────────────────────'
