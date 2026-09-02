-- _assert.sql — עזרי בדיקה משותפים לכל החבילות.
--
-- הכלל שנלמד פעמיים בדרך הקשה:
-- **בדיקת אבטחה מוכיחה את ההרשאה או את המצב, לא את קוד השגיאה.**
--
-- פעם ראשונה: `update profiles set role='owner'` נחסם ב-
-- "permission denied for schema auth" — פגם ב-shim, לא RLS.
-- פעם שנייה: כש-anon מקבל grant על students, השאילתה נופלת על
-- "permission denied for function my_branches" — אותו SQLSTATE 42501.
-- בשני המקרים בדיקה שתפסה insufficient_privilege דיווחה ✓ בטעות.

/**
 * ★ זהות המשתמשים נפתרת לפי תפקיד ולא לפי UUID קשיח.
 *
 * מקומית ה-UUID מגיעים מ-01_local_users.sql וקבועים. בענן GoTrue
 * מייצר אחרים בכל יצירה. בדיקה שנועלת UUID תיפול שם על סיבה טפלה
 * ותסתיר את מה שבאמת רצינו לבדוק.
 */
-- security definer: הפונקציה נקראת לפני שנקבעו ה-claims, ולכן
-- auth.uid() עדיין null ו-RLS על profiles היה מחזיר אפס שורות.
create or replace function t_user(p_role user_role) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from profiles where role = p_role and is_active order by created_at limit 1
$$;

/** claims מוכנים ל-set_config, לפי תפקיד. */
create or replace function t_claims(p_role user_role) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select json_build_object('sub', t_user(p_role), 'role', 'authenticated')::text
$$;

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

/**
 * ★ הצורה הנכונה לבדיקת חסימה.
 *
 * מריץ את הפעולה האסורה, בולע כל שגיאה, ומוכיח שהמצב לא השתנה.
 * לא אכפת לנו *למה* היא נחסמה — אכפת לנו שהיא לא קרתה. כך אף שגיאה
 * לא-קשורה לא יכולה להתחזות להצלחה.
 *
 * p_probe חייב להחזיר ערך סקלרי יחיד שמייצג את המצב.
 */
create or replace function assert_no_effect(p_label text, p_action text, p_probe text)
returns void language plpgsql as $$
declare v_before text; v_after text; v_state text; v_how text;
begin
  execute p_probe into v_before;

  begin
    execute p_action;
    v_how := 'ללא שגיאה';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_how := 'נחסם (' || v_state || ')';
  end;

  execute p_probe into v_after;

  if v_before is distinct from v_after then
    raise exception E'\n  ✗ ★ % — הפעולה השפיעה!\n    לפני: %\n    אחרי: %\n    (%)',
      p_label, v_before, v_after, v_how;
  end if;

  raise notice '  ✓ ★ % — ללא שינוי [%]', p_label, v_how;
end $$;

/**
 * מוכיח שלתפקיד אין הרשאת טבלה כלשהי — ברמת ה-GRANT, לא בזמן ריצה.
 * grant שנוסף בטעות נתפס כאן גם אם RLS במקרה מסתיר את השורות.
 */
create or replace function assert_no_table_privilege(p_role text, p_tables text[])
returns void language plpgsql as $$
declare tbl text; priv text; granted text[];
begin
  foreach tbl in array p_tables loop
    granted := '{}';
    foreach priv in array array['select','insert','update','delete'] loop
      if has_table_privilege(p_role, tbl, priv) then granted := granted || priv; end if;
    end loop;
    if array_length(granted, 1) > 0 then
      raise exception E'\n  ✗ ★ ל-% יש הרשאת % על טבלת %',
        p_role, array_to_string(granted, ', '), tbl;
    end if;
    raise notice '  ✓ ★ ל-% אין שום הרשאה על %', p_role, tbl;
  end loop;
end $$;

/** מוכיח שלתפקיד אין הרשאת הרצה על פונקציה. */
create or replace function assert_no_execute(p_role text, p_signature text)
returns void language plpgsql as $$
begin
  if has_function_privilege(p_role, p_signature, 'execute') then
    raise exception E'\n  ✗ ★ ל-% יש הרשאת הרצה על %', p_role, p_signature;
  end if;
  raise notice '  ✓ ★ ל-% אין הרשאת הרצה על %', p_role, p_signature;
end $$;

/**
 * ★ מונה את כל הטבלאות ב-public ומוודא שלאף אחת אין הרשאה לתפקיד.
 *
 * רשימה קבועה מפספסת טבלה חדשה. בסופבייס זה קריטי במיוחד: שם
 * `alter default privileges` מעניק הרשאות ל-anon על כל טבלה חדשה
 * אוטומטית, כך שמיגרציה עתידית שתשכח revoke תפתח דלת בשקט.
 */
create or replace function assert_no_privilege_on_any_table(p_role text, p_except text[] default '{}')
returns void language plpgsql as $$
declare tbl text; priv text; granted text[]; n int := 0;
begin
  for tbl in
    select tablename from pg_tables
     where schemaname = 'public' and not (tablename = any(p_except))
     order by tablename
  loop
    granted := '{}';
    foreach priv in array array['select','insert','update','delete'] loop
      if has_table_privilege(p_role, format('public.%I', tbl), priv) then
        granted := granted || priv;
      end if;
    end loop;
    if array_length(granted, 1) > 0 then
      raise exception E'\n  ✗ ★ ל-% יש הרשאת % על public.% — טבלה שנוספה בלי revoke',
        p_role, array_to_string(granted, ', '), tbl;
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception E'\n  ✗ הבדיקה לא עברה על אף טבלה'; end if;
  raise notice '  ✓ ★ ל-% אין הרשאה על אף אחת מ-% הטבלאות ב-public', p_role, n;
end $$;

/** אותו דבר לכל ה-views. */
create or replace function assert_no_privilege_on_any_view(p_role text)
returns void language plpgsql as $$
declare v text; n int := 0;
begin
  for v in select viewname from pg_views where schemaname = 'public' order by viewname loop
    if has_table_privilege(p_role, format('public.%I', v), 'select') then
      raise exception E'\n  ✗ ★ ל-% יש הרשאת select על התצוגה public.%', p_role, v;
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception E'\n  ✗ הבדיקה לא עברה על אף תצוגה'; end if;
  raise notice '  ✓ ★ ל-% אין הרשאה על אף אחת מ-% התצוגות', p_role, n;
end $$;

create or replace function drop_assert_helpers() returns void language plpgsql as $$
begin
  drop function if exists assert_eq(bigint, bigint, text);
  drop function if exists assert_true(boolean, text);
  drop function if exists assert_no_effect(text, text, text);
  drop function if exists assert_no_table_privilege(text, text[]);
  drop function if exists assert_no_privilege_on_any_table(text, text[]);
  drop function if exists assert_no_privilege_on_any_view(text);
  drop function if exists assert_no_execute(text, text);
  drop function if exists t_claims(user_role);
  drop function if exists t_user(user_role);
end $$;
