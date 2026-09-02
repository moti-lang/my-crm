-- 06_attendance_proof.sql — נוכחות ללא התחברות.
--
-- זו נקודת החשיפה היחידה במערכת שאינה מאחורי Auth. מי שמחזיקה את
-- הקישור — או מי שהקישור הודלף אליה — מגיעה לכאן.
-- שתי הטענות הנבדקות:
--   1. אפשר לסמן נוכחות בלי להתחבר.
--   2. אי אפשר לראות או לגעת בשום דבר מעבר לכך.

\set ON_ERROR_STOP on

create or replace function assert_eq(actual bigint, expected bigint, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception E'\n  ✗ %\n    התקבל: %   ציפינו: %', label, actual, expected;
  end if;
  raise notice '  ✓ % (%)', label, actual;
end $$;

create or replace function assert_true(cond boolean, label text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception E'\n  ✗ %', label; end if;
  raise notice '  ✓ %', label;
end $$;

begin;

-- טוקנים אמיתיים מה-seed
create temp table t as
select
  (select token from attendance_links al join branches b on b.id=al.branch_id
    where b.name='ביתר עילית' and al.is_active) as beitar,
  (select token from attendance_links al join branches b on b.id=al.branch_id
    where b.name='מודיעין עילית' and al.is_active) as modiin,
  (select id from branches where name='ביתר עילית') as beitar_id,
  (select id from branches where name='מודיעין עילית') as modiin_id,
  (select s.id from students s join branches b on b.id=s.branch_id
    where b.name='מודיעין עילית' and s.deleted_at is null limit 1) as modiin_student;
grant select on t to anon;

-- ═════════ anon: אפס גישה לטבלאות ═════════
-- נבדק על ההרשאה עצמה ולא על תפיסת שגיאה בזמן ריצה.
-- הסיבה: כש-anon כן מקבל grant על students, השאילתה נופלת על
-- "permission denied for function my_branches" — אותו קוד שגיאה בדיוק.
-- בדיקה שתופסת insufficient_privilege הייתה עוברת מהסיבה הלא נכונה.
\echo 'anon חסום מכל הטבלאות:'
do $$
declare tbl text; priv text; granted text[];
begin
  foreach tbl in array array['students','branches','lessons','attendance',
                             'attendance_links','payments','settings','wa_messages',
                             'profiles','ledger_entries','reminders','audit_log'] loop
    granted := '{}';
    foreach priv in array array['select','insert','update','delete'] loop
      if has_table_privilege('anon', tbl, priv) then
        granted := granted || priv;
      end if;
    end loop;
    if array_length(granted, 1) > 0 then
      raise exception E'\n  ✗ ★ ל-anon יש הרשאת % על טבלת %', array_to_string(granted, ', '), tbl;
    end if;
    raise notice '  ✓ ★ anon חסום מ-%', tbl;
  end loop;
end $$;

-- הגנה בעומק: גם בזמן ריצה, לא רק ברמת ההרשאה
set local role anon;
do $$ begin
  begin
    perform count(*) from students;
    raise exception E'\n  ✗ ★ anon הצליח לקרוא מטבלת students בפועל';
  exception when insufficient_privilege then
    raise notice '  ✓ ★ בזמן ריצה גם כן — anon נחסם מ-students';
  end;
end $$;

\echo 'anon אינו יכול להנפיק או לבטל קישורים:'
do $$ begin
  begin
    perform rpc_issue_attendance_link((select beitar_id from t));
    raise exception E'\n  ✗ ★ anon הנפיק קישור נוכחות!';
  exception when insufficient_privilege then
    raise notice '  ✓ ★ הנפקת קישור חסומה בפני anon';
  end;
end $$;

-- ═════════ הגיליון ═════════
\echo 'גיליון הנוכחות:'
do $$
declare sheet jsonb; raw text;
begin
  sheet := rpc_attendance_sheet((select beitar from t));

  perform assert_true((sheet->>'ok')::boolean, 'טוקן תקין מחזיר גיליון');
  perform assert_true(sheet->>'branch_name' = 'ביתר עילית', 'הגיליון נושא את שם הסניף');
  perform assert_true((sheet->>'lesson_date')::date = current_date, 'הגיליון הוא של היום');
  perform assert_eq(jsonb_array_length(sheet->'students'), 6, 'שש תלמידות בסניף');

  -- ★ מה שאסור שיהיה שם
  raw := sheet::text;
  perform assert_true(raw not like '%972%',      '★ אין אף מספר טלפון בגיליון');
  perform assert_true(raw not like '%parent%',   '★ אין פרטי הורה');
  perform assert_true(raw not like '%tuition%',  '★ אין שכר לימוד');
  perform assert_true(raw not like '%balance%',  '★ אין יתרות');
  perform assert_true(raw not like '%2000%',     '★ אין סכומי כסף');
  perform assert_true(raw not like '%הרב שך%',   '★ אין כתובות');
  perform assert_true(
    (select bool_and(s ?& array['id','full_name','mark'] and not (s ?| array['phone','birth_date','notes']))
     from jsonb_array_elements(sheet->'students') s),
    '★ לכל תלמידה מוחזרים שם ומזהה בלבד');
end $$;

\echo 'טוקנים לא תקינים:'
do $$
declare sheet jsonb;
begin
  sheet := rpc_attendance_sheet('לא-קיים');
  perform assert_true((sheet->>'ok')::boolean is false, 'טוקן שאינו קיים נדחה');
  perform assert_true(sheet->>'error' like '%אינו פעיל%', 'ההודעה בעברית וברורה');

  sheet := rpc_attendance_sheet('');
  perform assert_true((sheet->>'ok')::boolean is false, 'טוקן ריק נדחה');
end $$;

-- ═════════ שמירה ═════════
\echo 'שמירת סימונים:'
do $$
declare sheet jsonb; res jsonb; lesson uuid; marks jsonb;
begin
  sheet := rpc_attendance_sheet((select beitar from t));
  lesson := (sheet->>'lesson_id')::uuid;

  select jsonb_agg(jsonb_build_object('student_id', s->>'id', 'mark', 'present'))
    into marks from jsonb_array_elements(sheet->'students') s;

  res := rpc_attendance_submit((select beitar from t), lesson, marks);
  perform assert_true((res->>'ok')::boolean, 'שמירה מצליחה');
  perform assert_eq((res->>'saved')::bigint, 6, 'שש שורות נשמרו');
end $$;

-- הבדיקות הבאות זקוקות לקריאה מהטבלאות — חוזרים ל-postgres
reset role;
\echo 'התוצאה במסד:'
do $$
declare v_lesson uuid;
begin
  select id into v_lesson from lessons
   where branch_id = (select beitar_id from t) and lesson_date = current_date;
  perform assert_eq((select count(*) from attendance where lesson_id = v_lesson), 6,
                    'שש רשומות נוכחות נכתבו');
  perform assert_true((select status = 'reported' from lessons where id = v_lesson),
                      'השיעור סומן כמדווח');
  perform assert_true((select reported_at is not null from lessons where id = v_lesson),
                      'נרשמה שעת דיווח');
  perform assert_eq((select count(*) from audit_log
                      where source = 'attendance_link' and row_id = v_lesson), 1,
                    'הדיווח נרשם ביומן הביקורת');
end $$;

-- ═════════ ★ בידוד בין סניפים ═════════
set local role anon;
\echo 'בידוד בין סניפים:'
do $$
declare sheet_m jsonb; res jsonb; lesson_m uuid; marks jsonb; foreign_student uuid;
begin
  -- שיעור של מודיעין עילית
  sheet_m := rpc_attendance_sheet((select modiin from t));
  lesson_m := (sheet_m->>'lesson_id')::uuid;

  -- ★ טוקן של ביתר מנסה לכתוב לשיעור של מודיעין
  select jsonb_agg(jsonb_build_object('student_id', s->>'id', 'mark', 'absent'))
    into marks from jsonb_array_elements(sheet_m->'students') s;
  res := rpc_attendance_submit((select beitar from t), lesson_m, marks);
  perform assert_true((res->>'ok')::boolean is false,
                      '★ טוקן של ביתר אינו יכול לדווח על שיעור במודיעין');
  perform assert_true(res->>'error' like '%אינו שייך%', 'ההודעה מסבירה למה');

  -- ★ טוקן של ביתר מנסה להכניס תלמידה ממודיעין לשיעור של ביתר
  sheet_m := rpc_attendance_sheet((select beitar from t));
  foreign_student := (select modiin_student from t);
  res := rpc_attendance_submit(
    (select beitar from t),
    (sheet_m->>'lesson_id')::uuid,
    jsonb_build_array(jsonb_build_object('student_id', foreign_student, 'mark', 'present')));
  perform assert_true((res->>'ok')::boolean is false,
                      '★ אי אפשר לסמן תלמידה מסניף אחר');

  -- סימונים ריקים
  res := rpc_attendance_submit((select beitar from t), (sheet_m->>'lesson_id')::uuid, '[]'::jsonb);
  perform assert_true((res->>'ok')::boolean is false, 'רשימת סימונים ריקה נדחית');
end $$;

reset role;
-- ודא שהניסיונות החוצים לא כתבו כלום
\echo 'הניסיונות החוצים לא השאירו עקבות:'
do $$
declare v_lesson_m uuid;
begin
  select id into v_lesson_m from lessons
   where branch_id = (select modiin_id from t) and lesson_date = current_date;
  perform assert_eq((select count(*) from attendance where lesson_id = v_lesson_m), 0,
                    '★ אף סימון לא נכתב לשיעור של מודיעין');
  perform assert_true((select status = 'pending' from lessons where id = v_lesson_m),
                      '★ השיעור של מודיעין נשאר לא מדווח');
end $$;

-- ═════════ ביטול קישור ═════════
\echo 'ביטול קישור:'
update attendance_links set is_active = false
 where branch_id = (select beitar_id from t);
set local role anon;
do $$
declare sheet jsonb;
begin
  sheet := rpc_attendance_sheet((select beitar from t));
  perform assert_true((sheet->>'ok')::boolean is false, '★ קישור מבוטל מפסיק לעבוד מיד');
end $$;

rollback;

drop function assert_eq(bigint, bigint, text);
drop function assert_true(boolean, text);
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות הנוכחות עברו'
\echo '─────────────────────────────────────────'
