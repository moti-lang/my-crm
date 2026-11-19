-- 0054 — הקשחת אבטחה: פונקציית בדיקה שנשארה בענן, פתוחה ל-anon.
--
-- הממצא (ביקורת 11/2026): t_seed_student_count() קיימת בענן בלבד (לא בריפו — נוצרה ידנית),
-- SECURITY DEFINER, ו-anon יכול להריץ אותה: POST /rest/v1/rpc/t_seed_student_count החזיר
-- את מספר התלמידות שלא נרשמו בטופס, בלי התחברות. דליפה קטנה (מספר בלבד), אבל אסור.
--
-- התיקון: שוללים את ההרשאה מכולם. לא מוחקים — מחיקה מחכה לאישור (כלל: לא מוחקים בלי לשאול).
-- מקומית הפונקציה לא קיימת, ולכן הבלוק מותנה.
do $$
begin
  if to_regprocedure('public.t_seed_student_count()') is not null then
    revoke all on function public.t_seed_student_count() from public, anon, authenticated;
  end if;
end $$;
