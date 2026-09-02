-- 01_rls_proof.sql — הוכחת RLS. נכשל בקול רם אם יש חור.
-- כל בדיקה רצה כ-role 'authenticated' עם JWT claims אמיתיים, בדיוק כמו supabase-js.
-- אם קובץ זה עובר, ההפרדה בין הסניפים נאכפת במסד — לא בקוד הלקוח.

\set ON_ERROR_STOP on
\set OWNER    '''cccccccc-0000-0000-0000-000000000001'''
\set MANAGER  '''cccccccc-0000-0000-0000-000000000002'''
\set ACCT     '''cccccccc-0000-0000-0000-000000000003'''
\set BEITAR   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN   '''bbbbbbbb-0000-0000-0000-000000000002'''

create or replace function assert_eq(actual bigint, expected bigint, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception E'\n  ✗ %\n    התקבל: %   ציפינו: %', label, actual, expected;
  end if;
  raise notice '  ✓ % (%)', label, actual;
end $$;

-- ═════════════ בעלים: רואה הכל ═════════════
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :OWNER, 'role','authenticated')::text, true);
select assert_eq((select count(*) from branches), 5, 'בעלים רואה 5 סניפים');
select assert_eq((select count(*) from students), 21,'בעלים רואה 21 תלמידות');
select assert_eq((select count(*) from v_branch_pnl), 5, 'בעלים רואה רווחיות של 5 סניפים');
rollback;

-- ═════════════ מנהלת סניף: ביתר עילית בלבד ═════════════
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :MANAGER, 'role','authenticated')::text, true);

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

-- כתיבה לסניף אחר חייבת להיחסם
do $$ begin
  begin
    insert into students (season_id, branch_id, full_name)
    values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','חדירה');
    raise exception E'\n  ✗ ★ מנהלת הצליחה להוסיף תלמידה לסניף שאינו שלה!';
  exception when insufficient_privilege then
    raise notice '  ✓ ★ הוספת תלמידה לסניף אחר נחסמה';
  end;
end $$;

-- profiles_self משתמשת ב-auth.uid() ישירות בפוליסה. אם הגישה לסכמת auth
-- שבורה, הבדיקה הזו נופלת — וזו בדיוק הייתה התקלה ב-shim.
select assert_eq((select count(*) from profiles), 1, 'מנהלת קוראת את הפרופיל של עצמה בלבד');
select assert_eq((select count(*) from profiles where role = 'branch_manager'), 1,
                 'הפרופיל שהיא קוראת הוא שלה');

-- ═════════ הסלמת הרשאות: הקטגוריה המסוכנת ═════════
-- אם אחת מאלה עוברת, כל שאר הבדיקות חסרות ערך: מנהלת סניף
-- יכולה להפוך את עצמה לבעלים ואז לראות הכל כדין.

-- 1. שינוי התפקיד של עצמה ל-owner
do $$ declare n int; begin
  update profiles set role = 'owner' where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception E'\n  ✗ ★ הסלמה! מנהלת שינתה את התפקיד של עצמה ל-owner (% שורות)', n;
  end if;
  raise notice '  ✓ ★ הסלמה: שינוי התפקיד העצמי ל-owner שינה 0 שורות';
exception when insufficient_privilege then
  raise notice '  ✓ ★ הסלמה: שינוי התפקיד העצמי ל-owner נחסם';
end $$;

-- 2. שיוך עצמה לסניף שאינו שלה
do $$ declare n int; begin
  insert into branch_staff (branch_id, user_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002', auth.uid());
  get diagnostics n = row_count;
  raise exception E'\n  ✗ ★ הסלמה! מנהלת שייכה את עצמה לסניף מודיעין עילית (% שורות)', n;
exception
  when insufficient_privilege then
    raise notice '  ✓ ★ הסלמה: שיוך עצמי לסניף אחר נחסם';
  when unique_violation then
    raise exception E'\n  ✗ ★ הסלמה! השיוך לא נחסם ע"י RLS אלא רק ע"י מפתח כפול';
end $$;

-- 3. גרסאות נוספות של אותה התקפה
do $$ declare n int; begin
  -- שינוי התפקיד של משתמשת אחרת
  update profiles set role = 'branch_manager'
   where id = 'cccccccc-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception E'\n  ✗ ★ הסלמה! מנהלת שינתה את הפרופיל של הבעלים'; end if;
  raise notice '  ✓ ★ הסלמה: שינוי הפרופיל של הבעלים שינה 0 שורות';
exception when insufficient_privilege then
  raise notice '  ✓ ★ הסלמה: שינוי הפרופיל של הבעלים נחסם';
end $$;

do $$ declare n int; begin
  -- הזזת השיוך הקיים שלה לסניף אחר
  update branch_staff set branch_id = 'bbbbbbbb-0000-0000-0000-000000000002'
   where user_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception E'\n  ✗ ★ הסלמה! מנהלת הזיזה את השיוך שלה לסניף אחר'; end if;
  raise notice '  ✓ ★ הסלמה: הזזת השיוך לסניף אחר שינתה 0 שורות';
exception when insufficient_privilege then
  raise notice '  ✓ ★ הסלמה: הזזת השיוך לסניף אחר נחסמה';
end $$;

do $$ begin
  -- יצירת מספר מורשה חדש = דלת אחורית דרך הוואטסאפ
  begin
    insert into authorized_numbers (phone, label, scope, can_delete)
    values ('972500000000','דלת אחורית','all', true);
    raise exception E'\n  ✗ ★ הסלמה! מנהלת הוסיפה מספר מורשה לפקודות וואטסאפ';
  exception when insufficient_privilege then
    raise notice '  ✓ ★ הסלמה: הוספת מספר מורשה נחסמה';
  end;
end $$;

-- עדכון חוצה-סניפים חייב לא לגעת בכלום
do $$ declare n int; begin
  update students set notes = 'נחדר' where branch_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception E'\n  ✗ ★ עדכון חוצה-סניפים שינה % שורות!', n; end if;
  raise notice '  ✓ ★ עדכון תלמידות בסניף אחר שינה 0 שורות';
end $$;
rollback;

-- ═════════════ רואת חשבון: ללא טלפונים וכתובות ═════════════
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :ACCT, 'role','authenticated')::text, true);
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
rollback;

-- ═════════════ anon: אפס גישה לטבלאות ═════════════
begin;
set local role anon;
do $$ begin
  begin
    perform count(*) from students;
    raise exception E'\n  ✗ ★ anon הצליח לקרוא מטבלת students!';
  exception when insufficient_privilege then
    raise notice '  ✓ ★ anon נחסם מטבלת students';
  end;
  begin
    perform count(*) from payments;
    raise exception E'\n  ✗ ★ anon הצליח לקרוא מטבלת payments!';
  exception when insufficient_privilege then
    raise notice '  ✓ ★ anon נחסם מטבלת payments';
  end;
end $$;
rollback;

drop function assert_eq(bigint, bigint, text);
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות ה-RLS עברו'
\echo '─────────────────────────────────────────'
