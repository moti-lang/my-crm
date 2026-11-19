-- 0052 — הקשחת אבטחה: views לקריאה בלבד, ובלי הרשאות שהלקוח לא צריך.
--
-- הממצא (ביקורת אבטחה 11/2026): בסופבייס כל אובייקט חדש ב-public מקבל ALL ל-anon ול-authenticated
-- (pg_default_acl). ל-anon זה נשלל ב-0002, אבל ל-authenticated נשארו על כל 18 ה-views גם
-- INSERT/UPDATE/DELETE/TRUNCATE. שניים מהם ניתנים לעדכון אוטומטי (view על טבלה אחת) ורצים
-- בהרשאות הבעלים (security_invoker=false) — ולכן כתיבה דרכם עוקפת את ה-RLS של הטבלה:
--   · v_students_accounting — רואת חשבון (תפקיד לקריאה בלבד) יכלה לעדכן/למחוק תלמידות.
--   · v_branch_pnl          — משתמשת מחוברת, גם מושבתת, יכלה להוסיף סניף (INSERT בלי WHERE).
-- הוכח מקומית (בטרנזקציה שבוטלה); בענן אין כרגע רואת חשבון או מנהלת סניף פעילות.
-- ה-shim המקומי לא שיחזר את ברירות המחדל של סופבייס ולכן הבדיקות לא ראו את זה — תוקן גם שם.
--
-- התיקון:
--   1. כל view: SELECT ל-authenticated בלבד. anon ו-PUBLIC — כלום.
--   2. כל טבלה: בלי TRUNCATE (עוקף RLS), REFERENCES, TRIGGER ל-anon/authenticated. הלקוח לא
--      משתמש בהם, ו-PostgREST לא חושף אותם — זו שכבת הגנה נוספת.
--   3. ברירות המחדל לאובייקטים עתידיים: בלי הרשאות ל-anon/authenticated. כל מיגרציה מעניקה
--      במפורש את מה שצריך (כך עבדו המיגרציות ממילא — ה-shim המקומי מעולם לא העניק אוטומטית).

do $$
declare v record;
begin
  for v in
    select c.oid::regclass as rel
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')
  loop
    execute format('revoke all on %s from public, anon, authenticated', v.rel);
    execute format('grant select on %s to authenticated', v.rel);
  end loop;
end $$;

revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
