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
select assert_eq((select count(*) from payments), 6, 'מנהלת רואה תשלומים של ביתר בלבד');
select assert_eq((select count(*) from ledger_entries where branch_id is distinct from :BEITAR), 0,
                 '★ הוצאות של סניפים אחרים אינן נראות');
select assert_eq((select count(*) from lessons where branch_id <> :BEITAR), 0,
                 '★ שיעורים של סניפים אחרים אינם נראים');
select assert_eq((select count(*) from attendance_links where branch_id <> :BEITAR), 0,
                 '★ קישורי נוכחות של סניפים אחרים אינם נראים');
select assert_eq((select count(*) from settings), 0, 'מנהלת אינה רואה הגדרות מערכת');
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
