-- 0055 — הקשחת אבטחה: search_path קבוע לכל פונקציה ב-public.
--
-- הממצא (Security Advisor, function_search_path_mutable): 17 פונקציות עזר (חישובי תאריכים,
-- טריגרים, f_today_il וכו') בלי search_path קבוע. אף אחת מהן אינה SECURITY DEFINER ואף אחת
-- לא ניתנת להרצה מהלקוח, כך שהסיכון נמוך — אבל פונקציה בלי search_path קבוע מחפשת שמות
-- לפי ה-search_path של מי שקורא לה, וזה פתח להחלפת אובייקט (object shadowing).
--
-- התיקון: search_path = public, pg_temp — כמו בכל שאר הפונקציות במערכת. הלולאה תופסת כל
-- פונקציה כזו (גם כאלה שיתווספו בטעות), והבדיקה בסוף מוודאת שלא נשארה אחת.
do $$
declare f record; v_left int;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;

  select count(*) into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if v_left > 0 then raise exception 'נשארו % פונקציות בלי search_path', v_left; end if;
end $$;
