-- חור מכוון: בדיקת התפקיד של rpc_close_branch לפני 0053 (NULL עובר). לבקרת השלילה בלבד.
CREATE OR REPLACE FUNCTION public.rpc_close_branch(p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_open int; v_name text;
begin
  if auth_role() <> 'owner' then
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
end $function$

;
