-- 0063 — העברת תלמידה לסניף אחר (הבעלים, מכרטיס התלמידה).
--
-- ★ מה עובר: התלמידה עצמה — מעכשיו ברשימה, בנוכחות ובגבייה של הסניף החדש. הקבוצה מתאפסת
--   (שמות הקבוצות שייכים לסניף). הוראת קבע חיה — החיובים הבאים נרשמים בסניף החדש (ב-SUMIT
--   שום דבר לא משתנה). תזכורות שעוד לא יצאו — לסניף החדש.
-- ★ מה נשאר: תשלומים ונוכחות מהעבר — בסניף שבו קרו (f_payment_branch: "מעבר סניף אחר כך לא נוגע").
--   כך הדוחות של החודשים הקודמים לא זזים. שכר הלימוד וההנחה — כמו שהם.
-- ★ קישורי תשלום פתוחים מתבטלים (נוצרו עם שם הסניף הקודם), וההודעות שלהם שעוד לא יצאו — גם.
-- ★ יומן: כל שינוי סניף — מכל מסלול — נרשם בטריגר: מאיזה, לאיזה, מתי, מי.

create or replace function f_student_branch_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (coalesce('user:' || auth.uid()::text, 'system'), 'transfer_student', 'students', new.id,
          jsonb_build_object('branch_id', old.branch_id, 'branch_name', (select name from branches where id = old.branch_id), 'group_name', old.group_name),
          -- by_name: מי העבירה (ההיסטוריה לא קוראת את טבלת המשתמשות).
          jsonb_build_object('branch_id', new.branch_id, 'branch_name', (select name from branches where id = new.branch_id),
                             'by_name', (select full_name from profiles where id = auth.uid())),
          case when auth.uid() is null then 'system' else 'ui' end);
  return new;
end $$;
revoke all on function f_student_branch_audit() from public, anon, authenticated;
drop trigger if exists students_branch_audit on students;
create trigger students_branch_audit after update of branch_id on students
  for each row when (old.branch_id is distinct from new.branch_id) execute function f_student_branch_audit();

create or replace function rpc_transfer_student(p_student uuid, p_branch uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_from text; v_to text; v_links int; v_rem_cancel int; v_rem_moved int; v_orders int;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה להעביר תלמידה לסניף אחר' using errcode = '42501'; end if;
  select * into s from students where id = p_student for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if s.deleted_at is not null then raise exception 'התלמידה נמחקה — אי אפשר להעביר'; end if;
  if s.branch_id = p_branch then raise exception 'התלמידה כבר בסניף הזה'; end if;
  select name into v_to from branches where id = p_branch and deleted_at is null and is_active;
  if v_to is null then raise exception 'הסניף שנבחר לא קיים או סגור'; end if;
  select name into v_from from branches where id = s.branch_id;
  if exists (select 1 from students o where o.id <> s.id and o.season_id = s.season_id and o.branch_id = p_branch
               and o.deleted_at is null and o.cancelled_at is null and lower(btrim(o.full_name)) = lower(btrim(s.full_name))) then
    raise exception 'בסניף % כבר יש תלמידה בשם % — לשנות קודם את השם (למשל להוסיף שם משפחה)', v_to, s.full_name;
  end if;

  update students set branch_id = p_branch, group_name = null where id = s.id;

  -- קישורים פתוחים — עם שם הסניף הקודם. וההודעות שלהם שעוד לא יצאו.
  with c as (update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened') returning reminder_id)
  select count(*) into v_links from c;
  with c as (update reminders set status = 'cancelled', error = 'התלמידה הועברה לסניף אחר — הקישור בוטל'
              where student_id = s.id and status = 'scheduled' and kind = 'payment_link' returning 1)
  select count(*) into v_rem_cancel from c;
  with c as (update reminders set branch_id = p_branch where student_id = s.id and status = 'scheduled' returning 1)
  select count(*) into v_rem_moved from c;
  -- הוראת קבע חיה: החיובים הבאים — בסניף החדש. הסתיימה / נעצרה — היסטוריה, נשארת.
  with c as (update standing_orders set branch_id = p_branch where student_id = s.id and status not in ('cancelled', 'completed') returning 1)
  select count(*) into v_orders from c;

  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to, 'group_cleared', s.group_name is not null,
                            'links_cancelled', v_links, 'reminders_moved', v_rem_moved, 'standing_moved', v_orders);
end $$;
revoke all on function rpc_transfer_student(uuid, uuid) from public, anon;
grant execute on function rpc_transfer_student(uuid, uuid) to authenticated;

-- ─── היסטוריית הסניפים (בכרטיס) ───
-- מי שרואה את התלמידה רואה את ההיסטוריה. מי העבירה — מהיומן (by_name), בלי טבלת המשתמשות.
create or replace function rpc_student_branch_history(p_student uuid)
returns table (changed_at timestamptz, changed_by text, from_branch text, to_branch text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.created_at,
         case when a.actor = 'system' then 'המערכת' else coalesce(a.after ->> 'by_name', 'משתמשת לא מזוהה') end,
         a.before ->> 'branch_name', a.after ->> 'branch_name'
  from audit_log a
  where a.action = 'transfer_student' and a.row_id = p_student
    and exists (select 1 from students s where s.id = p_student
                  and (auth_role() in ('owner', 'accountant') or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches()))))
  order by a.created_at desc
$$;
revoke all on function rpc_student_branch_history(uuid) from public, anon;
grant execute on function rpc_student_branch_history(uuid) to authenticated;
