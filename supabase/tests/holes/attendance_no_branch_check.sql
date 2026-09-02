-- חור מכוון: מסיר את בדיקת שיוך השיעור לסניף ב-rpc_attendance_submit.
-- טוקן של סניף אחד יוכל לדווח על שיעור בסניף אחר. משמש רק את בקרת השלילה.
create or replace function rpc_attendance_submit(p_token text, p_lesson uuid, p_marks jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_link attendance_links; v_lesson lessons; v_count int;
begin
  select * into v_link from attendance_links where token = p_token and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'הקישור אינו פעיל, פני לניהול'); end if;
  select * into v_lesson from lessons where id = p_lesson;
  if not found then return jsonb_build_object('ok', false, 'error', 'השיעור לא נמצא'); end if;

  insert into attendance (lesson_id, student_id, mark, marked_at)
  select p_lesson, (m ->> 'student_id')::uuid, (m ->> 'mark')::attendance_mark, now()
  from jsonb_array_elements(p_marks) m
  on conflict (lesson_id, student_id) do update set mark = excluded.mark, marked_at = now();
  get diagnostics v_count = row_count;

  update lessons set status='reported', reported_at=coalesce(reported_at,now()) where id=p_lesson;
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('attendance_link:'||left(p_token,8), 'update', 'attendance', p_lesson,
          jsonb_build_object('marks', v_count), 'attendance_link');
  return jsonb_build_object('ok', true, 'saved', v_count);
end $$;
grant execute on function rpc_attendance_submit(text, uuid, jsonb) to anon, authenticated;
