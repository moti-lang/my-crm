-- 0053 — הקשחת אבטחה: בדיקות תפקיד שלא נופלות על NULL.
--
-- הממצא (ביקורת 11/2026): auth_role() מחזירה NULL למשתמשת מחוברת בלי תפקיד פעיל — כלומר
-- משתמשת שהושבתה (is_active=false) ועדיין מחזיקה טוקן, או נכנסת שוב בגוגל. בשתי פונקציות
-- הבדיקה נכתבה כך ש-NULL "עובר":
--   · rpc_close_branch:   if auth_role() <> 'owner'  →  NULL <> 'owner' הוא NULL, ה-if לא נכנס,
--     ומשתמשת מושבתת יכלה לסגור סניף ריק (ולראות שם סניף ומספר תלמידות בהודעת השגיאה).
--   · rpc_rename_student: if not (v_role = 'owner' or ...)  →  not NULL הוא NULL, וכנ"ל:
--     משתמשת מושבתת יכלה לשנות שם של תלמידה.
-- הוכח מקומית (בטרנזקציה שבוטלה). שאר הפונקציות נבדקו: או שהבדיקה כבר בטוחה ל-NULL
-- (is distinct from / is null or ...) או שהיא נשענת על my_branches(), שריקה למושבתת.
--
-- התיקון: שתי הבדיקות בטוחות ל-NULL (שאר הגוף זהה מילה במילה), ו-my_branches() מחזירה
-- סניפים רק למשתמשת פעילה — שכבת הגנה נוספת, גם אם שורת branch_staff נשארה אחרי השבתה.

CREATE OR REPLACE FUNCTION public.rpc_close_branch(p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_open int; v_name text;
begin
  if auth_role() is distinct from 'owner' then
    raise exception 'רק הבעלים יכולה לסגור סניף' using errcode = '42501';
  end if;
  select name into v_name from branches where id = p_branch and deleted_at is null;
  if v_name is null then raise exception 'הסניף לא נמצא'; end if;
  select count(*) into v_open from students
   where branch_id = p_branch and deleted_at is null and status in ('active', 'pending');
  if v_open > 0 then
    raise exception 'בסניף % יש % תלמידות פעילות או ממתינות. העבירי אותן לסניף אחר או סמני שהפסיקו, ואז אפשר לסגור.', v_name, v_open
      using errcode = 'P0001';
  end if;
  update branches set is_active = false, deleted_at = now() where id = p_branch;
  update attendance_links set is_active = false where branch_id = p_branch;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'close_branch', 'branches', p_branch, jsonb_build_object('name', v_name, 'closed', true));
end $function$;

CREATE OR REPLACE FUNCTION public.rpc_rename_student(p_id uuid, p_first text, p_last text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s students%rowtype; v_role user_role := auth_role(); v_first text; v_last text; v_full text; v_old_first text;
        v_rem int := 0; v_mail int := 0;
begin
  select * into s from students where id = p_id for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if not coalesce(v_role = 'owner' or (v_role = 'branch_manager' and s.branch_id in (select my_branches())), false) then
    raise exception 'אין הרשאה לשנות את שם התלמידה' using errcode = '42501';
  end if;
  if s.deleted_at is not null then raise exception 'התלמידה נמחקה — אי אפשר לשנות את השם'; end if;
  v_first := regexp_replace(btrim(coalesce(p_first, '')), '\s+', ' ', 'g');
  v_last := regexp_replace(btrim(coalesce(p_last, '')), '\s+', ' ', 'g');
  if v_first = '' then raise exception 'יש למלא שם פרטי'; end if;
  if length(v_first) > 60 or length(v_last) > 60 then raise exception 'השם ארוך מדי (עד 60 תווים)'; end if;
  if v_first !~ '^[֐-׿A-Za-z''"\-\s]+$' or (v_last <> '' and v_last !~ '^[֐-׿A-Za-z''"\-\s]+$') then
    raise exception 'השם יכול להכיל אותיות בלבד';
  end if;
  v_full := btrim(v_first || ' ' || v_last);
  if v_full = s.full_name then raise exception 'השם לא השתנה'; end if;
  if exists (select 1 from students o where o.id <> s.id and o.season_id = s.season_id and o.branch_id = s.branch_id
               and o.deleted_at is null and o.cancelled_at is null and lower(btrim(o.full_name)) = lower(v_full)) then
    raise exception 'כבר יש בסניף תלמידה בשם %', v_full;
  end if;
  v_old_first := coalesce(nullif(s.first_name, ''), split_part(s.full_name, ' ', 1));

  update students set first_name = v_first, last_name = nullif(v_last, ''), full_name = v_full where id = s.id;

  -- הודעות שעוד לא יצאו — עם השם החדש. מה שיצא — נשאר כפי שנשלח.
  with u as (
    update reminders set to_label = f_rename_in_text(to_label, s.full_name, v_full, v_old_first, v_first),
                         body = f_rename_in_text(body, s.full_name, v_full, v_old_first, v_first)
     where student_id = s.id and status = 'scheduled'
       and (body is distinct from f_rename_in_text(body, s.full_name, v_full, v_old_first, v_first)
            or to_label is distinct from f_rename_in_text(to_label, s.full_name, v_full, v_old_first, v_first))
    returning 1)
  select count(*) into v_rem from u;
  with u as (
    update email_messages set to_name = f_rename_in_text(to_name, s.full_name, v_full, v_old_first, v_first),
                              subject = f_rename_in_text(subject, s.full_name, v_full, v_old_first, v_first),
                              body = f_rename_in_text(body, s.full_name, v_full, v_old_first, v_first)
     where student_id = s.id and status = 'queued'
       and (body is distinct from f_rename_in_text(body, s.full_name, v_full, v_old_first, v_first)
            or subject is distinct from f_rename_in_text(subject, s.full_name, v_full, v_old_first, v_first)
            or to_name is distinct from f_rename_in_text(to_name, s.full_name, v_full, v_old_first, v_first))
    returning 1)
  select count(*) into v_mail from u;

  return jsonb_build_object('ok', true, 'full_name', v_full, 'from', s.full_name, 'reminders', v_rem, 'emails', v_mail);
end $function$;

create or replace function my_branches() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from branch_staff where user_id = auth.uid() and auth_role() is not null
$$;
revoke all on function my_branches() from public, anon;
grant execute on function my_branches() to authenticated;
