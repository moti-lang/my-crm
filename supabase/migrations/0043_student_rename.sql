-- 0043 — עריכת שם תלמידה.
--
-- ★ השם נשמר במקום אחד (students). גבייה, נוכחות, דוחות, דף האחראית, דף התשלום, הייצוא
--   והפקודות בוואטסאפ קוראים אותו משם — מתעדכנים מעצמם. העותקים היחידים של השם הם בהודעות
--   שכבר נכתבו: תזכורות וואטסאפ שעוד לא יצאו ומיילים שעוד בתור — שם השם מוחלף. מה שכבר יצא
--   נשאר כפי שנשלח (זה תיעוד). מסמכים ב-SUMIT (קבלות, תיאור הוראת הקבע) — מחוץ למערכת, לא משתנים.
-- ★ יומן: כל שינוי של השם — מכל מסלול (המסך, עדכון ישיר, ייבוא) — נרשם ב-audit_log בטריגר:
--   מי, מתי, מאיזה שם לאיזה.
-- ★ מי: הבעלים, ומנהלת סניף לתלמידות הסניף שלה — כמו ההרשאה לעדכן תלמידה (RLS).

-- ─────────── יומן: כל שינוי שם ───────────
create or replace function f_student_rename_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'rename_student', 'students', new.id,
          jsonb_build_object('full_name', old.full_name, 'first_name', old.first_name, 'last_name', old.last_name),
          -- by_name: מי שינתה, כפי שהשם שלה היה ברגע השינוי (ההיסטוריה לא קוראת את טבלת המשתמשות).
          jsonb_build_object('full_name', new.full_name, 'first_name', new.first_name, 'last_name', new.last_name,
                             'by_name', (select full_name from profiles where id = auth.uid())),
          case when auth.uid() is null then 'system' else 'ui' end);
  return new;
end $$;
revoke all on function f_student_rename_audit() from public, anon, authenticated;
drop trigger if exists students_rename_audit on students;
create trigger students_rename_audit after update of full_name on students
  for each row when (old.full_name is distinct from new.full_name) execute function f_student_rename_audit();

-- ─────────── השם בהודעה שכבר נכתבה ───────────
-- השם המלא — בכל מקום. השם הפרטי — כמילה שלמה, גם עם אות שימוש לפניה ("לשירה", "ושירה"),
-- ולא בתוך מילה אחרת ("רות" לא נוגעת ב"שירות").
create or replace function f_rename_in_text(p_text text, p_old_full text, p_new_full text, p_old_first text, p_new_first text) returns text
language sql immutable as $$
  select case
    when p_text is null then null
    when p_old_first is null or p_old_first = '' or p_old_first = p_new_first then replace(p_text, p_old_full, p_new_full)
    else regexp_replace(replace(p_text, p_old_full, p_new_full),
                        '(^|[^֐-׿A-Za-z])([והבכלמש]?)' || regexp_replace(p_old_first, '([.\\+*?\[^\]$(){}=!<>|:#-])', '\\\1', 'g')
                          || '(?=$|[^֐-׿A-Za-z])',
                        '\1\2' || p_new_first, 'g')
  end
$$;
revoke all on function f_rename_in_text(text, text, text, text, text) from public, anon, authenticated;

-- ─────────── עריכת השם (מהכרטיס) ───────────
create or replace function rpc_rename_student(p_id uuid, p_first text, p_last text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_role user_role := auth_role(); v_first text; v_last text; v_full text; v_old_first text;
        v_rem int := 0; v_mail int := 0;
begin
  select * into s from students where id = p_id for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if not (v_role = 'owner' or (v_role = 'branch_manager' and s.branch_id in (select my_branches()))) then
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
end $$;
revoke all on function rpc_rename_student(uuid, text, text) from public, anon;
grant execute on function rpc_rename_student(uuid, text, text) to authenticated;

-- ─────────── היסטוריית השם (בכרטיס) ───────────
-- מי שרואה את התלמידה רואה את ההיסטוריה שלה. מי ששינתה — מהרישום ביומן (by_name), בלי לגעת
-- בטבלת המשתמשות: פונקציה שהדפדפן מריץ לא נוגעת בה (15_users_screen_attack).
create or replace function rpc_student_name_history(p_student uuid)
returns table (changed_at timestamptz, changed_by text, from_name text, to_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.created_at,
         case when a.actor = 'system' then 'המערכת' else coalesce(a.after ->> 'by_name', 'משתמשת לא מזוהה') end,
         a.before ->> 'full_name', a.after ->> 'full_name'
  from audit_log a
  where a.action = 'rename_student' and a.row_id = p_student
    and exists (select 1 from students s where s.id = p_student
                  and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches()))))
  order by a.created_at desc
$$;
revoke all on function rpc_student_name_history(uuid) from public, anon;
grant execute on function rpc_student_name_history(uuid) to authenticated;
