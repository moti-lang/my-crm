-- 0013 — סגירת הרשאות ההרצה של פונקציות.
--
-- הבעיה: פוסטגרס מעניקה EXECUTE ל-PUBLIC על כל פונקציה חדשה.
-- כלומר anon יכול להריץ כל פונקציה שלא נשללה ממנו במפורש — וכל
-- פונקציה שתיכתב בעתיד תהיה פתוחה כברירת מחדל, אלא אם מישהו יזכור.
--
-- זו הייתה הנחת shim מהסוג שאנחנו מחפשים: מקומית אף אחד לא נגע
-- בפונקציות האלה, ולכן החשיפה לא הפריעה. בענן זה משטח התקפה
-- שגדל עם כל מיגרציה.
--
-- הפתרון הפוך: שוללים מכולם, ומעניקים במפורש רק את מה שנדרש.

do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

-- ─────────── ומעניקים במפורש, לפי צורך ───────────

-- פונקציות עזר של RLS: כל משתמש מחובר חייב אותן.
grant execute on function auth_role()   to authenticated;
grant execute on function my_branches() to authenticated;

-- חישוב כספי: משמש את v_general_allocation, שמסננת בעצמה לפי תפקיד.
grant execute on function f_general_allocation(uuid) to authenticated;

-- נוכחות: שתי הפונקציות היחידות שאנונימי רשאי להריץ בכל המערכת.
grant execute on function rpc_attendance_sheet(text)               to anon, authenticated;
grant execute on function rpc_attendance_submit(text, uuid, jsonb) to anon, authenticated;

-- ניהול קישורי נוכחות: מחובר בלבד. הפונקציות עצמן בודקות תפקיד.
grant execute on function rpc_issue_attendance_link(uuid)  to authenticated;
grant execute on function rpc_revoke_attendance_link(uuid) to authenticated;

-- פקודות וואטסאפ: service_role בלבד (Edge Functions). אין מסלול
-- שבו משתמש בדפדפן מבצע פקודה ישירות.
grant execute on function rpc_create_pending_command(text, text, jsonb, text) to service_role;
grant execute on function rpc_execute_command(uuid)      to service_role;
grant execute on function rpc_cancel_command(uuid)       to service_role;
grant execute on function rpc_cancel_last_command(text)  to service_role;

-- ─────────── ולעתיד: ברירת מחדל סגורה ───────────
-- פונקציה שתיווצר במיגרציה הבאה לא תהיה פתוחה ל-anon בטעות.
alter default privileges in schema public revoke execute on functions from public;
