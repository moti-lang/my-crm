-- חור מכוון: מחזיר את התלות ב-gen_random_bytes של pgcrypto בתוך
-- פונקציה עם search_path נעול ל-public. בסופבייס ההרחבה יושבת
-- בסכמת extensions ולכן הפונקציה לא תימצא. משמש רק את בקרת השלילה.
create or replace function rpc_issue_attendance_link(p_branch uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text;
begin
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and p_branch in (select my_branches())) then
    raise exception 'אין הרשאה' using errcode = 'insufficient_privilege';
  end if;
  update attendance_links set is_active = false where branch_id = p_branch and is_active;
  v_token := encode(gen_random_bytes(16), 'hex');
  insert into attendance_links (branch_id, token) values (p_branch, v_token);
  return v_token;
end $$;
grant execute on function rpc_issue_attendance_link(uuid) to authenticated;
