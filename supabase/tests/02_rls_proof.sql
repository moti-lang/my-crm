-- 01_rls_proof.sql — הוכחת RLS. נכשל בקול רם אם יש חור.
-- כל בדיקה רצה כ-role 'authenticated' עם JWT claims אמיתיים, בדיוק כמו supabase-js.
-- אם קובץ זה עובר, ההפרדה בין הסניפים נאכפת במסד — לא בקוד הלקוח.

\set ON_ERROR_STOP on
\set OWNER    ''t_user('owner'::user_role)''
\set MANAGER  ''t_user('branch_manager'::user_role)''
\set ACCT     ''t_user('accountant'::user_role)''
\set BEITAR   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN   '''bbbbbbbb-0000-0000-0000-000000000002'''

\ir _assert.sql

-- ═════════════ בעלים: רואה הכל ═════════════
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select t_user('owner'::user_role)), 'role','authenticated')::text, true);
select assert_eq((select count(*) from branches), 5, 'בעלים רואה 5 סניפים');
select assert_eq((select count(*) from students), 21,'בעלים רואה 21 תלמידות');
select assert_eq((select count(*) from v_branch_pnl), 5, 'בעלים רואה רווחיות של 5 סניפים');
select assert_eq((select round(sum(allocated_amount))::bigint from v_general_allocation), 12000,
                 'בעלים רואה חלוקה מלאה של 12,000');
select assert_eq((select count(*) from v_debtors), 12, 'בעלים רואה 12 חייבות');
rollback;

-- ═════════════ מנהלת סניף: ביתר עילית בלבד ═════════════
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select t_user('branch_manager'::user_role)), 'role','authenticated')::text, true);

select assert_eq((select count(*) from branches), 1, 'מנהלת רואה סניף אחד בלבד');
select assert_eq((select count(*) from branches where id = :BEITAR), 1, 'הסניף שהיא רואה הוא ביתר עילית');

-- ★ הבדיקה המרכזית: שאילתה ישירה על סניף אחר חייבת להחזיר אפס.
select assert_eq((select count(*) from branches where id = :MODIIN), 0,
                 '★ שאילתה ישירה על סניף אחר מחזירה 0 שורות');
select assert_eq((select count(*) from students where branch_id <> :BEITAR), 0,
                 '★ שאילתה ישירה על תלמידות מסניף אחר מחזירה 0 שורות');
select assert_eq((select count(*) from students), 6, 'מנהלת רואה 6 תלמידות (ביתר בלבד)');
select assert_eq((select count(*) from v_student_balance where branch_id <> :BEITAR), 0,
                 '★ תצוגת היתרות אינה דולפת סניפים אחרים');
select assert_eq((select count(*) from v_student_overview where branch_id <> :BEITAR), 0,
                 '★ תצוגת סקירת התלמידות אינה דולפת סניפים אחרים');
select assert_eq((select count(*) from v_debtors where branch_id <> :BEITAR), 0,
                 '★ רשימת החייבות אינה דולפת סניפים אחרים');
select assert_eq((select count(*) from v_debtors), 4, 'מנהלת רואה 4 חייבות בביתר');
select assert_eq((select count(*) from v_general_allocation), 0,
                 '★ מנהלת סניף אינה רואה חלוקת הוצאות — עדיף כלום על מספר שגוי');
select assert_eq((select count(*) from v_student_overview), 6,
                 'מנהלת רואה 6 תלמידות בתצוגת הסקירה');
select assert_eq((select count(*) from payments), 6, 'מנהלת רואה תשלומים של ביתר בלבד');
select assert_eq((select count(*) from ledger_entries where branch_id is distinct from :BEITAR), 0,
                 '★ הוצאות של סניפים אחרים אינן נראות');
select assert_eq((select count(*) from lessons where branch_id <> :BEITAR), 0,
                 '★ שיעורים של סניפים אחרים אינם נראים');
select assert_eq((select count(*) from attendance_links where branch_id <> :BEITAR), 0,
                 '★ קישורי נוכחות של סניפים אחרים אינם נראים');
-- מנהלת רואה מפתח הגדרות אחד בלבד: מצב חיבור הוואטסאפ, שנחוץ לאינדיקטור.
-- כל שאר ההגדרות — שעות שקטות, טלפון הבעלים, ספי אישור — סגורות בפניה.
select assert_eq((select count(*) from settings), 1, 'מנהלת רואה מפתח הגדרות אחד בלבד');
select assert_eq((select count(*) from settings where key <> 'wa_health'), 0,
                 '★ המפתח היחיד שהיא רואה הוא wa_health');
select assert_eq((select count(*) from settings where key = 'owner_phone'), 0,
                 '★ טלפון הבעלים אינו נגיש למנהלת סניף');
select assert_eq((select count(*) from authorized_numbers), 0, 'מנהלת אינה רואה מספרים מורשים');
select assert_eq((select count(*) from audit_log), 0, 'מנהלת אינה רואה יומן ביקורת');

-- כתיבה לסניף אחר: הראיה היא שמספר התלמידות בסניף היעד לא השתנה,
-- לא איזו שגיאה נזרקה בדרך.
select assert_no_effect(
  'הוספת תלמידה לסניף אחר',
  $a$insert into students (season_id, branch_id, full_name)
     values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','חדירה')$a$,
  $p$select count(*)::text from public.students
      where branch_id = 'bbbbbbbb-0000-0000-0000-000000000002'$p$);

-- profiles_self משתמשת ב-auth.uid() ישירות בפוליסה. אם הגישה לסכמת auth
-- שבורה, הבדיקה הזו נופלת — וזו בדיוק הייתה התקלה ב-shim.
select assert_eq((select count(*) from profiles), 1, 'מנהלת קוראת את הפרופיל של עצמה בלבד');
select assert_eq((select count(*) from profiles where role = 'branch_manager'), 1,
                 'הפרופיל שהיא קוראת הוא שלה');

-- ═════════ הסלמת הרשאות: הקטגוריה המסוכנת ═════════
-- אם אחת מאלה עוברת, כל שאר הבדיקות חסרות ערך: מנהלת סניף
-- יכולה להפוך את עצמה לבעלים ואז לראות הכל כדין.

-- 1. שינוי התפקיד של עצמה ל-owner
select assert_no_effect(
  'הסלמה: שינוי התפקיד העצמי ל-owner',
  $a$update profiles set role = 'owner' where id = auth.uid()$a$,
  $p$select role::text from public.profiles
      where id = t_user('branch_manager'::user_role)$p$);

-- 2. שיוך עצמה לסניף שאינו שלה
select assert_no_effect(
  'הסלמה: שיוך עצמי לסניף אחר',
  $a$insert into branch_staff (branch_id, user_id)
     values ('bbbbbbbb-0000-0000-0000-000000000002', auth.uid())$a$,
  $p$select string_agg(branch_id::text, ',' order by branch_id) from public.branch_staff
      where user_id = t_user('branch_manager'::user_role)$p$);

-- 3. גרסאות נוספות של אותה התקפה
select assert_no_effect(
  'הסלמה: שינוי הפרופיל של הבעלים',
  $a$update profiles set role = 'branch_manager'
     where id = t_user('owner'::user_role)$a$,
  $p$select role::text from public.profiles
      where id = t_user('owner'::user_role)$p$);

select assert_no_effect(
  'הסלמה: הזזת השיוך הקיים לסניף אחר',
  $a$update branch_staff set branch_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where user_id = auth.uid()$a$,
  $p$select string_agg(branch_id::text, ',' order by branch_id) from public.branch_staff
      where user_id = t_user('branch_manager'::user_role)$p$);

select assert_no_effect(
  'הסלמה: הוספת מספר מורשה לפקודות וואטסאפ',
  $a$insert into authorized_numbers (phone, label, scope, can_delete)
     values ('972500000000','דלת אחורית','all', true)$a$,
  $p$select count(*)::text from public.authorized_numbers$p$);

-- עדכון חוצה-סניפים חייב לא לגעת בכלום
select assert_no_effect(
  'עדכון תלמידות בסניף אחר',
  $a$update students set notes = 'נחדר'
     where branch_id = 'bbbbbbbb-0000-0000-0000-000000000002'$a$,
  $p$select count(*)::text from public.students
      where branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' and notes = 'נחדר'$p$);
rollback;

-- ═════════════ רואת חשבון: ללא טלפונים וכתובות ═════════════
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select t_user('accountant'::user_role)), 'role','authenticated')::text, true);
select assert_eq((select count(*) from students), 0,
                 '★ רואת חשבון אינה קוראת מטבלת students ישירות');
select assert_eq((select count(*) from v_student_overview), 0,
                 '★ רואת חשבון אינה רואה את תצוגת הסקירה (יש בה טלפונים)');
select assert_eq((select count(*) from v_students_accounting), 21,
                 'רואת חשבון רואה 21 תלמידות דרך התצוגה המסוננת');
select assert_eq((select count(*) from information_schema.columns
                  where table_name='v_students_accounting'
                    and column_name in ('parent_phone','alt_phone','address','email')), 0,
                 '★ התצוגה אינה כוללת טלפון, כתובת או אימייל');
select assert_eq((select count(*) from branches), 5, 'רואת חשבון רואה את כל הסניפים');
-- ★ הבאג שהיה כאן: f_general_allocation רצה בהרשאות הקורא, ולרואת חשבון
-- אין גישה ל-students. משקלי by_students יצאו אפס וההוצאה נעלמה בשקט —
-- 8,400 במקום 12,000. אותו מספר כספי חייב להיראות זהה לשני התפקידים.
select assert_eq((select round(sum(allocated_amount))::bigint from v_general_allocation), 12000,
                 '★ רואת חשבון רואה חלוקה מלאה של 12,000 (לא 8,400)');
rollback;

-- ═════════════ anon: אפס גישה ═════════════
-- נבדק ברמת ה-GRANT ולא בתפיסת שגיאה בזמן ריצה. הסיבה: עם grant על
-- students השאילתה נופלת על "permission denied for function my_branches"
-- — אותו SQLSTATE 42501, ובדיקה שתופסת אותו הייתה מדווחת ✓ בטעות.
-- דינמי ולא רשימה קבועה: טבלה שתיווסף במיגרציה עתידית בלי revoke
-- תיתפס כאן. בסופבייס זה קריטי — שם alter default privileges מעניקה
-- הרשאות ל-anon על כל טבלה חדשה אוטומטית.
select assert_no_privilege_on_any_table('anon');
select assert_no_privilege_on_any_view('anon');

-- גם ההרצה של פונקציות פנימיות סגורה בפניו
select assert_no_execute('anon', 'auth_role()');
select assert_no_execute('anon', 'my_branches()');
select assert_no_execute('anon', 'f_general_allocation(uuid)');
select assert_no_execute('anon', 'rpc_issue_attendance_link(uuid)');
select assert_no_execute('anon', 'rpc_revoke_attendance_link(uuid)');

-- ═════════ פונקציות העזר עצמן — בדיקה חיובית ═════════
-- היו להן רק בדיקות חסימה. כל פוליסה במערכת נשענת עליהן, ואם הן
-- מחזירות ערך שגוי — RLS "עובד" ומחזיר את הנתונים הלא נכונים.
begin;
set local role authenticated;

select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true(auth_role() = 'owner', '★ auth_role מחזירה owner לבעלים');
select assert_eq((select count(*) from my_branches()), 0,
                 'my_branches ריקה לבעלים — היא רואה הכל דרך התפקיד');

select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_true(auth_role() = 'branch_manager', '★ auth_role מחזירה branch_manager');
select assert_eq((select count(*) from my_branches()), 1, '★ my_branches מחזירה סניף אחד');
select assert_true((select name = 'ביתר עילית' from branches
                     where id in (select my_branches())),
                   '★ my_branches מחזירה את הסניף הנכון');

select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_true(auth_role() = 'accountant', '★ auth_role מחזירה accountant');

-- משתמש שאינו קיים
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
select assert_true(auth_role() is null, '★ auth_role מחזירה null ל-sub שאינו קיים');
select assert_eq((select count(*) from my_branches()), 0, 'my_branches ריקה ל-sub לא קיים');
select assert_eq((select count(*) from branches), 0,
                 '★ ומשם — sub לא קיים אינו רואה שום סניף');

-- משתמש מושבת
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
rollback;

begin;
-- ה-claims נקבעים לפני ההשבתה: t_user מסננת פרופילים פעילים, ואחריה
-- הייתה מחזירה null — ו-auth_role() "עוברת" מהסיבה הלא נכונה.
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
update profiles set is_active = false where role = 'branch_manager';
set local role authenticated;
select assert_true(auth_role() is null, '★ auth_role מחזירה null למשתמש מושבת');
select assert_eq((select count(*) from branches), 0,
                 '★ משתמש מושבת אינו רואה דבר');
rollback;

-- ומה שכן פתוח לו — בדיוק שתי הפונקציות של דף הנוכחות
select assert_true(has_function_privilege('anon','rpc_attendance_sheet(text)','execute'),
                   'anon יכול להריץ את rpc_attendance_sheet');
select assert_true(has_function_privilege('anon','rpc_attendance_submit(text,uuid,jsonb)','execute'),
                   'anon יכול להריץ את rpc_attendance_submit');

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות ה-RLS עברו'
\echo '─────────────────────────────────────────'
