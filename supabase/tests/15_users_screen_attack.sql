-- 15_users_screen_attack.sql — מסך המשתמשות תחת תקיפה: מנהלת סניף ורואת חשבון
-- מנסות, בכל מסלול שיש ל-supabase-js (טבלה ישירה, REST), להזמין, להעלות
-- תפקיד, לשייך סניף, להשבית בעלים. כל ניסיון: אפס השפעה.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_attack(p_role user_role) returns void language plpgsql as $$
declare
  v_me uuid := t_user(p_role);
  v_owner_row uuid; v_my_row uuid;
  probe text := $p$select (select count(*) from allowed_users) || '/' || (select string_agg(email || ':' || role || ':' || is_active || ':' || coalesce(branch_id::text,'-'), ',' order by email) from allowed_users)
                 || '/' || (select string_agg(id || ':' || role || ':' || is_active, ',' order by id) from profiles)
                 || '/' || (select count(*) || ':' || coalesce(string_agg(user_id || '@' || branch_id, ',' order by user_id, branch_id), '') from branch_staff)$p$;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  -- המזהים נמשכים כבעלים (RLS מסתיר אותם מהתוקפת), ואז חוזרים לזהות התוקפת.
  perform set_config('request.jwt.claims', t_claims('owner'::user_role), true);
  v_owner_row := (select id from allowed_users where role = 'owner' and user_id is not null limit 1);
  v_my_row := (select id from allowed_users where user_id = v_me);
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  perform assert_eq((select count(*) from allowed_users), 1, format('%s רואה ברשימת המורשים רק את עצמה', p_role));
  perform assert_no_effect(format('★ %s: הזמנת אימייל חדש כבעלים', p_role),
    $a$insert into allowed_users (email, full_name, role) values ('attacker@gmail.com', 'תוקפת', 'owner')$a$, probe);
  perform assert_no_effect(format('★ %s: הזמנת אימייל חדש כמנהלת סניף אחר', p_role),
    format($a$insert into allowed_users (email, full_name, role, branch_id) values ('attacker2@gmail.com', 'תוקפת', 'branch_manager', %L)$a$, 'bbbbbbbb-0000-0000-0000-000000000002'), probe);
  perform assert_no_effect(format('★ %s: העלאת התפקיד של עצמה לבעלים', p_role),
    format($a$update allowed_users set role = 'owner' where id = %L$a$, v_my_row), probe);
  perform assert_no_effect(format('★ %s: העלאת התפקיד דרך profiles', p_role),
    format($a$update profiles set role = 'owner' where id = %L$a$, v_me), probe);
  perform assert_no_effect(format('★ %s: שיוך עצמי לסניף נוסף ב-branch_staff', p_role),
    format($a$insert into branch_staff (user_id, branch_id) values (%L, %L)$a$, v_me, 'bbbbbbbb-0000-0000-0000-000000000002'), probe);
  perform assert_no_effect(format('★ %s: שינוי הסניף של עצמה ברשימה', p_role),
    format($a$update allowed_users set branch_id = %L where id = %L$a$, 'bbbbbbbb-0000-0000-0000-000000000002', v_my_row), probe);
  perform assert_no_effect(format('★ %s: השבתת הבעלים', p_role),
    format($a$update allowed_users set is_active = false where id = %L$a$, v_owner_row), probe);
  perform assert_no_effect(format('★ %s: מחיקת הבעלים מהרשימה', p_role),
    format($a$delete from allowed_users where id = %L$a$, v_owner_row), probe);
  perform assert_no_effect(format('★ %s: מחיקת הפרופיל של הבעלים', p_role),
    format($a$delete from profiles where role = 'owner'$a$), probe);
  perform assert_no_effect(format('★ %s: עדכון "כולם" (בלי where) ברשימה', p_role),
    $a$update allowed_users set role = 'accountant'$a$, probe);
  perform assert_no_effect(format('★ %s: הפעלה מחדש של משתמשת מושבתת', p_role),
    $a$update allowed_users set is_active = true where is_active = false$a$, probe);
end $$;

\echo 'מנהלת סניף:'
begin;
set local role authenticated;
select t_attack('branch_manager'::user_role);
rollback;

\echo 'רואת חשבון:'
begin;
set local role authenticated;
select t_attack('accountant'::user_role);
rollback;

\echo 'anon (מפתח ציבורי בלבד):'
begin;
select assert_no_table_privilege('anon', '{allowed_users,profiles,branch_staff}');
rollback;

\echo 'אין פונקציה שמאפשרת לעקוף: אף security definer שניתן להריץ אינו כותב לרשימה'
begin;
select assert_eq((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and (p.prosrc ilike '%allowed_users%' or p.prosrc ilike '%branch_staff%' or p.prosrc ilike '%profiles%')
   and p.prorettype <> 'trigger'::regtype
   and has_function_privilege('authenticated', p.oid, 'execute')
   and p.proname not in ('auth_role', 'my_branches') and p.proname not like 't\_%'), 0,
  '★ הפונקציות היחידות ש-authenticated מריצה ונוגעות ברשימה: auth_role ו-my_branches (קריאה בלבד)');
rollback;

drop function if exists t_attack(user_role);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
