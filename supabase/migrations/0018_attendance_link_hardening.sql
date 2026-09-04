-- 0018_attendance_link_hardening.sql — קישור הנוכחות: תפוגה והתראת הצפה.
--
-- הקישור עובר בין מנהלות סניף בוואטסאפ וידלוף מתישהו. שני כללים חדשים,
-- שניהם במסד (הפונקציות הן security definer ו-anon מגיע רק אליהן):
--   1. תפוגה: 90 יום בלי שימוש → הקישור מת, כאילו בוטל.
--   2. הצפה: יותר מ-ATTENDANCE_FLOOD דיווחים בשעה מאותו טוקן → התראה
--      לבעלים (system_alerts + audit_log), פעם אחת לשעה. הדיווחים עצמם
--      ממשיכים להישמר — הצפה אינה סיבה לחסום את האחראית האמיתית — אבל
--      הבעלים יודעת שהקישור בידיים לא נכונות ומנפיקה חדש.

create or replace function f_attendance_link_alive(p_link attendance_links) returns boolean
language sql immutable as $$
  select p_link.is_active
     and coalesce(p_link.last_used_at, p_link.created_at) > now() - interval '90 days'
$$;
revoke all on function f_attendance_link_alive(attendance_links) from public, anon, authenticated;

-- ─────────── הגיליון: אותה פונקציה, עם התפוגה ───────────
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
  if not f_attendance_link_alive(v_link) then
    return jsonb_build_object('ok', false, 'error', 'הקישור פג תוקף אחרי 90 יום ללא שימוש, פני לניהול לקישור חדש');
  end if;

  select * into v_branch from branches where id = v_link.branch_id and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הקישור אינו פעיל, פני לניהול');
  end if;

  -- השיעור של היום. אם ה-cron טרם יצר אותו, יוצרים כאן —
  -- עדיף שהאחראית תדווח מאשר שתיתקל במסך ריק. (כמו ב-0010.)
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

-- ─────────── הדיווח: תפוגה + התראת הצפה ───────────
create or replace function rpc_attendance_submit(p_token text, p_lesson uuid, p_marks jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_link   attendance_links;
  v_lesson lessons;
  v_count  int;
  v_hour_hits int;
  v_actor  text;
begin
  select * into v_link from attendance_links where token = p_token and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'הקישור אינו פעיל, פני לניהול');
  end if;
  if not f_attendance_link_alive(v_link) then
    return jsonb_build_object('ok', false, 'error', 'הקישור פג תוקף אחרי 90 יום ללא שימוש, פני לניהול לקישור חדש');
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

  v_actor := 'attendance_link:' || left(p_token, 8);
  insert into audit_log (actor, action, table_name, row_id, after, source)
  values (v_actor, 'update', 'attendance', p_lesson,
          jsonb_build_object('marks', v_count), 'attendance_link');

  -- ★ הצפה: יותר מ-30 דיווחים בשעה מאותו קישור. אחראית אמיתית מדווחת
  -- פעם-פעמיים ביום. התראה אחת לשעה, לא אחת לכל בקשה.
  select count(*) into v_hour_hits from audit_log
   where actor = v_actor and source = 'attendance_link' and created_at > now() - interval '1 hour';
  if v_hour_hits > 30 and not exists (
       select 1 from system_alerts
        where kind = 'attendance_link_flood' and meta ->> 'actor' = v_actor
          and created_at > now() - interval '1 hour') then
    insert into system_alerts (kind, severity, title, body, meta)
    values ('attendance_link_flood', 'warning',
            'הצפת דיווחים מקישור נוכחות — ייתכן שהקישור דלף',
            format('%s דיווחים בשעה האחרונה מהקישור של סניף %s. מומלץ להנפיק קישור חדש במסך הנוכחות.',
                   v_hour_hits, (select name from branches where id = v_link.branch_id)),
            jsonb_build_object('actor', v_actor, 'branch_id', v_link.branch_id, 'hits', v_hour_hits));
  end if;

  return jsonb_build_object('ok', true, 'saved', v_count);
end $$;

-- ההרשאות נשמרות: anon ו-authenticated מריצים את שתי הפונקציות בלבד.
revoke all on function rpc_attendance_sheet(text)               from public;
revoke all on function rpc_attendance_submit(text, uuid, jsonb) from public;
grant execute on function rpc_attendance_sheet(text)               to anon, authenticated;
grant execute on function rpc_attendance_submit(text, uuid, jsonb) to anon, authenticated;
