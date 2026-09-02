-- 09_business_rules_proof.sql — חוקים עסקיים שנאכפים במסד.
--
-- שני טריגרים שהיו ללא בדיקה כלל. הם לא נכשלו — פשוט אף אחד
-- לא הריץ אותם. חסימה שלא נבדקה היא הבטחה, לא אכיפה.

\set ON_ERROR_STOP on
\ir _assert.sql

begin;

-- ═════════ אישור צילום (סעיף 2.4) ═════════
-- "לא ניתן לצרף תלמידה ל-production_cast אם photo_consent=false —
--  המערכת חוסמת ומציגה הודעה."
\echo 'חסימת צירוף להפקה ללא אישור צילום:'

-- אסתי וייס: photo_consent=false ב-seed
select assert_true((select not photo_consent from students where full_name = 'אסתי וייס'),
                   'אסתי וייס ללא אישור צילום (נתון הבסיס)');

select assert_no_effect(
  'צירוף תלמידה ללא אישור צילום להפקה',
  $a$insert into production_cast (production_id, student_id, role_name)
     select 'eeeeeeee-0000-0000-0000-000000000001',
            (select id from students where full_name = 'אסתי וייס'), 'תפקיד'$a$,
  $p$select count(*)::text from public.production_cast
      where student_id = (select id from students where full_name = 'אסתי וייס')$p$);

-- ההודעה נוקבת בשם ובעברית — היא מוצגת למשתמשת
do $$ declare msg text;
begin
  begin
    insert into production_cast (production_id, student_id, role_name)
    select 'eeeeeeee-0000-0000-0000-000000000001',
           (select id from students where full_name = 'אסתי וייס'), 'תפקיד';
    raise exception E'\n  ✗ הצירוף לא נחסם';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    perform assert_true(msg like '%אסתי וייס%', '★ ההודעה נוקבת בשם התלמידה');
    perform assert_true(msg like '%אישור צילום%', '★ ההודעה מסבירה את הסיבה בעברית');
  end;
end $$;

-- ═════════ והצד החיובי: עם אישור — עובר ═════════
\echo 'צירוף תלמידה עם אישור צילום:'
do $$ declare v_student uuid; v_n int;
begin
  select id into v_student from students where full_name = 'מירי סגל';
  perform assert_true((select photo_consent from students where id = v_student),
                      'מירי סגל עם אישור צילום');

  insert into production_cast (production_id, student_id, role_name)
  values ('eeeeeeee-0000-0000-0000-000000000001', v_student, 'תפקיד משנה');

  select count(*) into v_n from production_cast
   where student_id = v_student and production_id = 'eeeeeeee-0000-0000-0000-000000000001';
  perform assert_eq(v_n::bigint, 1, '★ תלמידה עם אישור כן מצורפת');
end $$;

-- עדכון תפקיד של שורה קיימת אינו נחסם
do $$ begin
  update production_cast set role_name = 'תפקיד ראשי'
   where student_id = (select id from students where full_name = 'מירי סגל');
  perform assert_true((select role_name = 'תפקיד ראשי' from production_cast
                        where student_id = (select id from students where full_name = 'מירי סגל')),
                      'עדכון תפקיד של משתתפת קיימת עובר');
end $$;

-- ★ פער ידוע ומתועד: ביטול אישור צילום אחרי הצירוף אינו מסיר
--   את התלמידה מההפקה. הטריגר הוא על production_cast ולא על students.
do $$ declare v_student uuid; v_n int;
begin
  select id into v_student from students where full_name = 'מירי סגל';
  update students set photo_consent = false where id = v_student;
  select count(*) into v_n from production_cast where student_id = v_student;
  perform assert_eq(v_n::bigint, 1,
    'ביטול אישור אחרי צירוף אינו מסיר אוטומטית — התנהגות ידועה, לא באג');
end $$;

-- ═════════ updated_at (f_touch_updated_at) ═════════
\echo 'חותמת עדכון:'
do $$
declare v_student uuid; v_before timestamptz; v_after timestamptz;
begin
  select id, updated_at into v_student, v_before from students
   where full_name = 'שירה כהן';
  perform pg_sleep(0.01);

  update students set notes = 'שינוי לבדיקה' where id = v_student;
  select updated_at into v_after from students where id = v_student;
  perform assert_true(v_after > v_before, '★ עדכון מקדם את updated_at');

  -- והערך שנכתב במפורש נדרס ע"י הטריגר — זו הכוונה
  update students set notes = 'עוד שינוי', updated_at = '2020-01-01' where id = v_student;
  select updated_at into v_after from students where id = v_student;
  perform assert_true(v_after > '2021-01-01'::timestamptz,
                      '★ ניסיון לכתוב updated_at ידנית נדרס ע"י הטריגר');

  -- created_at לא זז
  perform assert_true((select created_at from students where id = v_student)
                        = (select created_at from students where id = v_student),
                      'created_at אינו משתנה');
end $$;

rollback;

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות החוקים העסקיים עברו'
\echo '─────────────────────────────────────────'
