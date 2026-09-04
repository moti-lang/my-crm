-- 10_portability_proof.sql — הנחות שנכונות מקומית ולא בענן.
--
-- הבאג שהוליד את הקובץ הזה: rpc_issue_attendance_link קראה ל-
-- gen_random_bytes עם search_path נעול ל-public. מקומית ההרחבה
-- הייתה ב-public ולכן זה עבד; בסופבייס היא בסכמת extensions.
--
-- הקובץ מכליל: כל פונקציה עם search_path נעול נבדקת מול כל מה
-- שקיים בסכמות שאינן בנתיב שלה. בדיקה אחת לכל המחלקה, לא למקרה.

\set ON_ERROR_STOP on
\ir _assert.sql

-- ═════════ 1. אף פונקציה עם search_path נעול אינה קוראת להרחבה ═════════
\echo 'תלות בהרחבות מתוך search_path נעול:'
do $$
declare
  fn      record;
  ext_fn  text;
  path    text;
  body    text;
  hits    text[];
  checked int := 0;
begin
  for fn in
    select p.oid, p.proname,
           pg_get_functiondef(p.oid) as def,
           array_to_string(p.proconfig, ' ') as cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prokind = 'f'
      and p.proconfig is not null
      and array_to_string(p.proconfig, ' ') like '%search_path%'
      and p.proname not like 't\_%' and p.proname not like 'assert\_%'
  loop
    path := substring(fn.cfg from 'search_path=([^ ]*)');
    -- אם extensions בנתיב, אין בעיה
    continue when path like '%extensions%';

    body := fn.def;
    hits := '{}';

    for ext_fn in
      select distinct p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname not in ('public', 'pg_catalog', 'information_schema', 'pg_temp')
        and n.nspname not like 'pg_%'
        -- שם שקיים גם ב-pg_catalog נפתר תמיד, כי pg_catalog קודם
        -- לכל דבר בנתיב. gen_random_uuid היא בדיוק כזו: היא ב-PG13+
        -- ובנוסף pgcrypto מספקת אותה.
        and not exists (
          select 1 from pg_proc c
          join pg_namespace cn on cn.oid = c.pronamespace and cn.nspname = 'pg_catalog'
          where c.proname = p.proname
        )
    loop
      -- קריאה לפונקציה: השם ואחריו סוגריים, לא כחלק ממילה ארוכה יותר
      if body ~ ('(?<![A-Za-z0-9_.])' || ext_fn || '\s*\(') then
        hits := hits || ext_fn;
      end if;
    end loop;

    if array_length(hits, 1) > 0 then
      raise exception E'\n  ✗ ★ %() עם search_path=%\n    קוראת ל-% שאינה בנתיב.\n    מקומית זה עלול לעבוד; בענן היא לא תימצא.',
        fn.proname, path, array_to_string(hits, ', ');
    end if;
    checked := checked + 1;
  end loop;

  if checked = 0 then
    raise exception E'\n  ✗ לא נבדקה אף פונקציה — הבדיקה ריקה';
  end if;
  raise notice '  ✓ ★ % פונקציות עם search_path נעול, אף אחת אינה תלויה בהרחבה', checked;
end $$;

-- ═════════ 2. ההרחבות אינן ב-public ═════════
-- אם הן ב-public, ה-shim אינו נאמן וכל הבדיקה למעלה חסרת ערך.
\echo 'מבנה הסכמות תואם לסופבייס:'
do $$
declare e record; n int := 0;
begin
  for e in
    select x.extname, s.nspname
    from pg_extension x join pg_namespace s on s.oid = x.extnamespace
    where x.extname not in ('plpgsql')
  loop
    if e.nspname = 'public' then
      raise exception E'\n  ✗ ★ ההרחבה % מותקנת ב-public. בסופבייס היא ב-extensions,\n    וה-shim מסתיר כשלים במקום לחשוף אותם.', e.extname;
    end if;
    n := n + 1;
  end loop;
  perform assert_true(n > 0, '★ יש הרחבות, וכולן מחוץ ל-public');
end $$;

-- ═════════ 3. כל פונקציה security definer נועלת search_path ═════════
-- פונקציה כזו רצה בהרשאות הבעלים. בלי נעילה, משתמש יכול להקדים
-- סכמה משלו ב-search_path ולהחליף פונקציה שהיא קוראת לה.
\echo 'נעילת search_path בפונקציות security definer:'
do $$
declare fn record; n int := 0;
begin
  for fn in
    select p.proname, p.proconfig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.prosecdef and p.prokind = 'f'
      and p.proname not like 't\_%' and p.proname not like 'assert\_%'
  loop
    if fn.proconfig is null
       or array_to_string(fn.proconfig, ' ') not like '%search_path%' then
      raise exception E'\n  ✗ ★ %() היא security definer ללא search_path נעול', fn.proname;
    end if;
    n := n + 1;
  end loop;
  perform assert_true(n >= 6, format('★ %s פונקציות security definer, כולן עם נתיב נעול', n));
end $$;

-- ═════════ 4. anon לא קיבל הרשאות דרך ברירת מחדל ═════════
-- בסופבייס alter default privileges מעניקה ל-anon הרשאות על כל
-- טבלה חדשה. מיגרציה שתשכח revoke תפתח דלת בשקט.
\echo 'הרשאות ברירת מחדל:'
select assert_no_privilege_on_any_table('anon');
select assert_no_privilege_on_any_view('anon');

-- ═════════ 5. anon אינו יכול להריץ אף פונקציה מלבד השתיים ═════════
\echo 'הרצת פונקציות ע"י anon:'
do $$
-- עזרי הבדיקה (t_*, assert_*) נוצרים ונמחקים בתוך ההרצה ואינם
-- חלק מהסכמה. נבדקות רק פונקציות הייצור.
-- עזרי הבדיקה (t_*, assert_*) נקראים בחבילות גם בתור anon ונמחקים בסוף
-- הריצה. drop_assert_helpers אינו מוחרג: הוא נמצא בענן עם הרשאת הרצה
-- ל-anon בדיוק בגלל ההחרגה שהייתה כאן.
declare fn record; allowed text[] := array['rpc_attendance_sheet','rpc_attendance_submit'];
        n int := 0;
begin
  for fn in
    select p.proname, p.oid as fnoid
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.prokind = 'f' and p.proname not like 't\_%' and p.proname not like 'assert\_%'
  loop
    if has_function_privilege('anon', fn.fnoid, 'execute') then
      if not (fn.proname = any(allowed)) then
        raise exception E'\n  ✗ ★ ל-anon יש הרשאת הרצה על %() — לא ברשימה המותרת', fn.proname;
      end if;
      n := n + 1;
    end if;
  end loop;
  perform assert_eq(n::bigint, 2, '★ בדיוק שתי פונקציות פתוחות ל-anon');
end $$;

-- ═════════ 6. אין תלות בטבלאות auth מלבד ה-FK ═════════
-- ה-shim מספק auth.users מפושטת. קוד שקורא ממנה שדות נוספים
-- יעבוד מקומית וייכשל או יחזיר null בענן.
\echo 'תלות בסכמת auth:'
do $$
declare fn record; hits text[] := '{}';
begin
  for fn in
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.prokind = 'f'
  loop
    if fn.def ~ 'auth\.users' then hits := hits || fn.proname; end if;
  end loop;
  if array_length(hits, 1) > 0 then
    raise exception E'\n  ✗ ★ פונקציות שקוראות מ-auth.users: %\n    ה-shim מספק גרסה מפושטת שלה.',
      array_to_string(hits, ', ');
  end if;
  raise notice '  ✓ ★ אף פונקציה אינה קוראת מ-auth.users';
  perform assert_true(
    (select count(*) from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_class f on f.oid = c.confrelid
      join pg_namespace fn2 on fn2.oid = f.relnamespace
     where fn2.nspname = 'auth' and c.contype = 'f') = 1,
    '★ קשר יחיד ל-auth.users: המפתח הזר של profiles');
end $$;

-- ─────────────────────────────────────────────────────────────
-- ★ ה-search_path של המסד עצמו אינו כולל extensions.
--
-- פרויקט סופבייס חדש מתחיל עם "$user", public. כל עוד ה-shim הוסיף
-- extensions לנתיב של המסד, אזכור לא-מוסמך לאובייקט מסכמת ההרחבות
-- עבד כאן ונפל בענן. זה בדיוק מה שקרה עם gin_trgm_ops באינדקס
-- students_name_trgm: 417 בדיקות ירוקות, ומיגרציה 0001 נופלת על מסד טרי.
--
-- הבדיקה הזאת נועלת את הקביים: אם מישהו יחזיר את ההקלה, החבילה תיפול.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_path text;
begin
  select coalesce(
    (select setconfig[array_position(
       (select array_agg(split_part(x, '=', 1)) from unnest(setconfig) x),
       'search_path')]
     from pg_db_role_setting s
     join pg_database d on d.oid = s.setdatabase
     where d.datname = current_database() and s.setrole = 0),
    '') into v_path;

  if v_path ~ 'extensions' then
    raise exception E'\n  ✗ ★ ל-search_path של המסד הוחזרה extensions: %\n    זה מסתיר אזכורים לא-מוסמכים שנופלים על פרויקט סופבייס טרי.', v_path;
  end if;
  raise notice '  ✓ ★ search_path של המסד אינו כולל extensions (כמו פרויקט טרי)';

  -- וההוכחה החיובית: ההרחבות באמת יושבות ב-extensions ולא ב-public,
  -- כלומר האזכורים במיגרציות באמת נאלצו להסמיך בעצמם.
  perform assert_true(
    (select count(*) from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
      where e.extname in ('pgcrypto','pg_trgm') and n.nspname = 'extensions') = 2,
    '★ pgcrypto ו-pg_trgm יושבות ב-extensions');
end $$;

select drop_assert_helpers();
-- ★ אחרי הניקוי לא נשאר אף עזר בדיקה — כולל המנקה עצמו.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
   where p.proname like 't\_%' or p.proname like 'assert\_%' or p.proname = 'drop_assert_helpers';
  if n > 0 then raise exception E'\n  ✗ ★ % עזרי בדיקה נשארו בסכמה אחרי drop_assert_helpers()', n; end if;
  raise notice '  ✓ ★ אף עזר בדיקה לא נשאר בסכמה';
end $$;
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות הניידות עברו'
\echo '─────────────────────────────────────────'
