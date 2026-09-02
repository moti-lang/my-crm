-- 0010 — נוכחות ללא התחברות.
--
-- אחראית הנוכחות אינה משתמשת רשומה. היא נכנסת בטוקן בלבד, ולכן זו
-- נקודת החשיפה היחידה במערכת שאינה מאחורי Auth. שני כללים:
--   1. ל-anon אין גישה לאף טבלה. הכל עובר בשתי פונקציות security definer.
--   2. הפונקציות מחזירות שמות בלבד — בלי טלפונים, בלי כתובות, בלי כסף.

-- ─────────── הנפקת טוקנים ───────────
create or replace function rpc_issue_attendance_link(p_branch uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text;
begin
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and p_branch in (select my_branches())) then
    raise exception 'אין הרשאה להנפיק קישור לסניף הזה' using errcode = 'insufficient_privilege';
  end if;

  -- קישור קודם מבוטל: קישור שהודלף לא נשאר תקף לנצח.
  update attendance_links set is_active = false where branch_id = p_branch and is_active;

  v_token := encode(gen_random_bytes(16), 'hex');   -- 32 תווים
  insert into attendance_links (branch_id, token) values (p_branch, v_token);
  return v_token;
end $$;

create or replace function rpc_revoke_attendance_link(p_branch uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner'
     and not (auth_role() = 'branch_manager' and p_branch in (select my_branches())) then
    raise exception 'אין הרשאה לבטל קישור לסניף הזה' using errcode = 'insufficient_privilege';
  end if;
  update attendance_links set is_active = false where branch_id = p_branch and is_active;
end $$;

-- ─────────── דף האחראית ───────────
/**
 * מחזיר את גיליון הנוכחות של היום לפי טוקן.
 *
 * מה שחוזר: שם הסניף, שם האחראית, תאריך, מזהה השיעור, ורשימת שמות.
 * מה שלא חוזר, ולעולם לא יחזור: טלפונים, כתובות, שכר לימוד, יתרות.
 * מי שמחזיקה את הקישור יכולה לסמן נוכחות ולא לראות דבר מעבר לכך.
 *
 * חוזרת גם עם הסימונים הקיימים, כדי שכניסה חוזרת באותו יום תראה את
 * מה שכבר סומן ותאפשר תיקון.
 */
create or replace function rpc_attendance_sheet(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link    attendance_links;
  v_branch  branches;
  v_lesson  lessons;
  v_students jsonb;
begin
  select * into v_link from attendance_links where token = p_token and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הקישור אינו פעיל, פני לניהול');
  end if;

  select * into v_branch from branches where id = v_link.branch_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הקישור אינו פעיל, פני לניהול');
  end if;

  -- השיעור של היום. אם ה-cron טרם יצר אותו, יוצרים כאן —
  -- עדיף שהאחראית תדווח מאשר שתיתקל במסך ריק.
  select * into v_lesson from lessons
   where branch_id = v_link.branch_id and lesson_date = current_date;
  if not found then
    insert into lessons (branch_id, lesson_date, status)
    values (v_link.branch_id, current_date, 'pending')
    returning * into v_lesson;
  end if;

  if v_lesson.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'השיעור של היום בוטל');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'full_name', s.full_name, 'mark', a.mark
         ) order by s.full_name), '[]'::jsonb)
    into v_students
  from students s
  left join attendance a on a.student_id = s.id and a.lesson_id = v_lesson.id
  where s.branch_id = v_link.branch_id
    and s.deleted_at is null
    and s.status in ('active', 'pending');

  update attendance_links set last_used_at = now() where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'branch_name', v_branch.name,
    'supervisor_name', v_branch.supervisor_name,
    'lesson_date', v_lesson.lesson_date,
    'lesson_id', v_lesson.id,
    'already_reported', v_lesson.status = 'reported',
    'students', v_students
  );
end $$;

/**
 * שומר את הסימונים.
 *
 * p_marks: [{"student_id": uuid, "mark": "present|late|absent|excused"}]
 *
 * מאמת שהטוקן פעיל, **ושהשיעור שייך לסניף של הטוקן** — אחרת טוקן של
 * סניף אחד יכול לכתוב נוכחות לסניף אחר. מאמת גם שכל תלמידה שייכת
 * לאותו סניף.
 *
 * עדכון מותר עד חצות של אותו יום.
 */
create or replace function rpc_attendance_submit(p_token text, p_lesson uuid, p_marks jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link   attendance_links;
  v_lesson lessons;
  v_count  int;
begin
  select * into v_link from attendance_links where token = p_token and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הקישור אינו פעיל, פני לניהול');
  end if;

  select * into v_lesson from lessons where id = p_lesson;
  if not found or v_lesson.branch_id <> v_link.branch_id then
    return jsonb_build_object('ok', false, 'error', 'השיעור אינו שייך לסניף הזה');
  end if;
  if v_lesson.lesson_date <> current_date then
    return jsonb_build_object('ok', false, 'error', 'אפשר לדווח רק על השיעור של היום');
  end if;

  if jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    return jsonb_build_object('ok', false, 'error', 'לא התקבלו סימונים');
  end if;

  -- כל תלמידה חייבת להיות בסניף של הטוקן.
  select count(*) into v_count
  from jsonb_array_elements(p_marks) m
  where not exists (
    select 1 from students s
    where s.id = (m ->> 'student_id')::uuid
      and s.branch_id = v_link.branch_id
      and s.deleted_at is null
  );
  if v_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'אחת התלמידות אינה שייכת לסניף הזה');
  end if;

  insert into attendance (lesson_id, student_id, mark, marked_at)
  select p_lesson, (m ->> 'student_id')::uuid, (m ->> 'mark')::attendance_mark, now()
  from jsonb_array_elements(p_marks) m
  on conflict (lesson_id, student_id)
  do update set mark = excluded.mark, marked_at = now();

  get diagnostics v_count = row_count;

  update lessons
     set status = 'reported',
         reported_at = coalesce(reported_at, now()),
         reported_by = (select supervisor_name from branches where id = v_link.branch_id)
   where id = p_lesson;

  update attendance_links set last_used_at = now() where id = v_link.id;

  insert into audit_log (actor, action, table_name, row_id, after, source)
  values ('attendance_link:' || left(p_token, 8), 'update', 'attendance', p_lesson,
          jsonb_build_object('marks', v_count), 'attendance_link');

  return jsonb_build_object('ok', true, 'saved', v_count);
end $$;

-- ─────────── הרשאות ───────────
-- anon מקבל את שתי הפונקציות האלה בלבד. שום טבלה, שום פונקציה אחרת.
revoke all on function rpc_attendance_sheet(text)            from public;
revoke all on function rpc_attendance_submit(text, uuid, jsonb) from public;
revoke all on function rpc_issue_attendance_link(uuid)       from public;
revoke all on function rpc_revoke_attendance_link(uuid)      from public;

grant execute on function rpc_attendance_sheet(text)            to anon, authenticated;
grant execute on function rpc_attendance_submit(text, uuid, jsonb) to anon, authenticated;
grant execute on function rpc_issue_attendance_link(uuid)       to authenticated;
grant execute on function rpc_revoke_attendance_link(uuid)      to authenticated;

-- ─────────── תצוגת נוכחות לניהול ───────────
create view v_lesson_summary as
select l.id as lesson_id, l.branch_id, b.name as branch_name, l.lesson_date, l.status,
       l.reported_at, l.reported_by,
       count(a.student_id) filter (where a.mark in ('present','late')) as attended,
       count(a.student_id)                                            as marked,
       (select count(*) from students s
         where s.branch_id = l.branch_id and s.deleted_at is null and s.status = 'active') as expected
from lessons l
join branches b on b.id = l.branch_id
left join attendance a on a.lesson_id = l.id
where b.deleted_at is null
  and (
    auth_role() in ('owner', 'accountant')
    or (auth_role() = 'branch_manager' and l.branch_id in (select my_branches()))
  )
group by l.id, l.branch_id, b.name, l.lesson_date, l.status, l.reported_at, l.reported_by;

alter view v_lesson_summary set (security_invoker = false);
revoke all on v_lesson_summary from anon;
grant select on v_lesson_summary to authenticated;
