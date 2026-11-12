-- 34_security_hardening.sql — ביקורת האבטחה של 11/2026 (מיגרציות 0052–0057).
-- כל ממצא: ההוכחה שהחור סגור, ובדיקה כללית שתתפוס חור דומה שיתווסף בעתיד.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_sh(p_sql text, p_sub uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR ' || sqlstate || ': ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;

\echo 'הרשאות: views לקריאה בלבד (0052):'
select assert_true(not exists (
  select 1 from information_schema.role_table_grants g join pg_class c on c.relname = g.table_name and c.relkind in ('v', 'm')
   where g.table_schema = 'public' and g.grantee in ('authenticated', 'anon', 'PUBLIC') and g.privilege_type <> 'SELECT'),
  '★ אין view ב-public עם INSERT/UPDATE/DELETE/TRUNCATE ל-authenticated/anon');
select assert_no_privilege_on_any_view('anon');
select assert_true(not exists (
  select 1 from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee in ('authenticated', 'anon', 'PUBLIC') and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  '★ אין TRUNCATE/REFERENCES/TRIGGER ל-anon/authenticated על אף טבלה (TRUNCATE עוקף RLS)');
select assert_true(not exists (
  select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclnamespace = 'public'::regnamespace and pg_get_userbyid(d.defaclrole) = 'postgres'
     and a.grantee in (0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'))),
  '★ ברירות המחדל לאובייקטים חדשים: בלי הרשאות ל-anon/authenticated/PUBLIC');

\echo 'החור עצמו — כתיבה דרך view שרץ כבעלים (0052, 0056):'
-- נבדקת התוצאה, לא רק קוד השגיאה: אחרי 0056 ה-view לא ניתן לעדכון בכלל (55000), ובלי 0056 —
-- אין הרשאה (42501). כל אחד מהם לבדו סוגר את החור.
begin;
create temp table t_victim as select id, discount from students where deleted_at is null and status = 'active' limit 1;
grant select on t_victim to authenticated;
select assert_true(t_sh('update v_students_accounting set discount = 999 where id = (select id from t_victim) returning 1', t_user('accountant')) like 'ERROR%',
                   '★ רואת חשבון לא יכולה לעדכן תלמידה דרך v_students_accounting');
select assert_true((select s.discount is not distinct from v.discount from students s join t_victim v on v.id = s.id), '...וההנחה לא השתנתה');
select assert_true(t_sh('delete from v_students_accounting where id = (select id from t_victim) returning 1', t_user('accountant')) like 'ERROR%',
                   '★ ...ולא למחוק');
select assert_eq((select count(*) from students where id = (select id from t_victim)), 1, '...והתלמידה קיימת');
update profiles set is_active = false where id = t_user('accountant');
select assert_true(t_sh($q$insert into v_branch_pnl (name) values ('פרוץ') returning 1$q$,
                   (select id from profiles where role = 'accountant')) like 'ERROR%',
                   '★ משתמשת מושבתת לא יכולה להוסיף סניף דרך v_branch_pnl');
select assert_eq((select count(*) from branches where name = 'פרוץ'), 0, '...ואין סניף "פרוץ"');
rollback;
select assert_true(not exists (select 1 from information_schema.views where table_schema = 'public' and (is_updatable = 'YES' or is_insertable_into = 'YES')),
                   '★ אין view ב-public שניתן לעדכן או להוסיף דרכו');

\echo 'views: security_invoker, אותו סינון לפי תפקיד (0056):'
select assert_true(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions, '{}') @> '{security_invoker=true}'),
                   '★ כל ה-views ב-public — security_invoker=true');
select assert_true(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'private' and (has_function_privilege('anon', p.oid, 'execute')
                                      or not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))),
                   '★ הפונקציות ב-private: anon לא מריץ, search_path קבוע');
select assert_true(not has_schema_privilege('anon', 'private', 'usage'), 'anon — בלי גישה לסכמה private');
-- משתמשת מחוברת בלי תפקיד (מושבתת): 0 שורות בכל view.
create temp table t_views as select viewname from pg_views where schemaname = 'public';
grant select on t_views to authenticated;
do $$
declare v text; n bigint; r text;
begin
  for v in select viewname from t_views order by 1 loop
    r := t_sh(format('select count(*)::text from %I', v), '00000000-0000-0000-0000-00000000dead');
    if r <> '0' then raise exception E'\n  ✗ ★ משתמשת בלי תפקיד רואה % ב-%', r, v; end if;
  end loop;
  raise notice '  ✓ ★ משתמשת בלי תפקיד: 0 שורות בכל % ה-views', (select count(*) from t_views);
end $$;
select assert_true(t_sh('select count(*)::text from v_students_accounting', t_user('accountant'))::int > 0,
                   'רואת חשבון עדיין רואה את v_students_accounting');
select assert_true(t_sh('select count(*)::text from v_student_balance', t_user('accountant'))::int > 0,
                   '★ רואת חשבון עדיין רואה יתרות (בלי גישה ל-students)');
select assert_true(t_sh('select count(*)::text from v_mailing_list', t_user('accountant')) = '0', 'רשימת התפוצה — לבעלים בלבד');
select assert_true(t_sh('select count(*)::text from v_general_allocation', t_user('owner'))::int > 0,
                   'חלוקת ההוצאות הכלליות עדיין מוצגת לבעלים');
select assert_true(t_sh($q$select count(*)::text from v_student_balance b where b.branch_id not in (select my_branches())$q$,
                        t_user('branch_manager')) = '0', '★ מנהלת סניף — רק הסניף שלה');
select assert_no_execute('authenticated', 'f_general_allocation(uuid)');
select assert_no_execute('anon', 'f_general_allocation(uuid)');

\echo 'בדיקות תפקיד בטוחות ל-NULL (0053):'
begin;
-- הבעלים הושבתה (is_active=false) אבל הטוקן שלה עדיין בתוקף.
create temp table t_ex as select t_user('owner') as owner_id, t_user('branch_manager') as mgr_id,
       (select id from students where deleted_at is null and status = 'active' limit 1) as student_id;
grant select on t_ex to authenticated;
insert into branches (name, is_active) values ('סניף ריק לבדיקה', true);
update profiles set is_active = false where id in (select owner_id from t_ex);
select assert_true(t_sh(format('select rpc_rename_student(%L, %L, %L)::text', (select student_id from t_ex), 'שם', 'חדש'),
                        (select owner_id from t_ex)) like 'ERROR 42501%', '★ משתמשת מושבתת לא משנה שם של תלמידה');
select assert_true(t_sh(format('select rpc_close_branch(%L)::text', (select id from branches where name = 'סניף ריק לבדיקה')),
                        (select owner_id from t_ex)) like 'ERROR 42501%', '★ משתמשת מושבתת לא סוגרת סניף (גם ריק)');
select assert_true((select deleted_at is null from branches where name = 'סניף ריק לבדיקה'), '...והסניף לא נסגר');
-- מנהלת סניף שהושבתה ישירות בפרופיל (שורת branch_staff נשארה).
update profiles set is_active = false where id in (select mgr_id from t_ex);
select assert_true(t_sh('select count(*)::text from my_branches()', (select mgr_id from t_ex)) = '0',
                   '★ מנהלת מושבתת — my_branches() ריקה גם אם נשארה שורת שיוך');
select assert_true(t_sh(format('select rpc_create_payment_link(%L, 10)::text', (select student_id from t_ex)), (select mgr_id from t_ex)) like 'ERROR 42501%',
                   'מנהלת מושבתת לא יוצרת קישור תשלום');
select assert_true(t_sh('select count(*)::text from rpc_students_export(null)', (select mgr_id from t_ex)) = '0', 'מנהלת מושבתת לא מייצאת תלמידות');
rollback;
select assert_true(t_sh('select count(*)::text from my_branches()', t_user('branch_manager'))::int > 0, 'מנהלת פעילה — my_branches() כרגיל');

\echo 'פונקציות (0054, 0055):'
select assert_true(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
     -- עזרי הבדיקות (_assert.sql) חיים רק בזמן הריצה ואינם חלק מהסכמה.
     and p.proname not like 'assert\_%' and p.proname not in ('drop_assert_helpers', 't_sh')),
  '★ לכל פונקציה ב-public יש search_path קבוע');
select assert_true(coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
                      and p.proname not in ('assert_eq', 'assert_true', 'assert_no_effect', 'assert_no_table_privilege', 'assert_no_execute',
                                            'assert_no_privilege_on_any_table', 'assert_no_privilege_on_any_view', 't_user', 't_claims',
                                            't_student_count', 't_sh')), '') =
                   'rpc_attendance_sheet,rpc_attendance_submit,rpc_email_unsubscribe,rpc_enrollment_public,rpc_payment_link_program,rpc_payment_link_public',
                   '★ anon מריץ רק את 6 הפונקציות של הדפים הציבוריים (טוקן בקישור)');
select assert_true(to_regprocedure('public.t_seed_student_count()') is null
                   or not has_function_privilege('anon', 'public.t_seed_student_count()', 'execute'),
                   'פונקציית הבדיקה שנשארה בענן — לא פתוחה ל-anon');

\echo 'wa_config — שרת בלבד (0057):'
select assert_true(exists (select 1 from pg_policies where tablename = 'wa_config' and policyname = 'wa_config_server_only' and permissive = 'RESTRICTIVE'),
                   'policy מגבילה מפורשת על wa_config');
select assert_no_table_privilege('authenticated', '{wa_config}');
select assert_no_table_privilege('anon', '{wa_config}');

drop function t_sh(text, uuid);
select drop_assert_helpers();
\echo '  הקשחת אבטחה (0052–0057): הכל עבר'
