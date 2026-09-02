-- 0012 — אישור, ביצוע וביטול של פקודות וואטסאפ.
--
-- שלוש החלטות שמעצבות את כל הקובץ:
--
-- 1. **פקודה ממתינה חיה במסד, לא בזיכרון.** Edge Function מתה בין
--    הודעה להודעה. אישור שנשען על state בתהליך פשוט יאבד — ההורה
--    תכתוב "כן" ולא יקרה כלום. לכן commands.expires_at.
--
-- 2. **הביצוע כולו בפונקציה אחת בטרנזקציה אחת.** תפיסת הפקודה,
--    הכתיבה, ורישום הביקורת — או שהכל קורה או שכלום לא קורה. אם
--    הכתיבה נכשלת, גם שינוי הסטטוס מתבטל, והפקודה נשארת ממתינה.
--
-- 3. **התפיסה אטומית: UPDATE ... WHERE status='pending_confirm'.**
--    שתי הודעות "כן" בו זמנית — השנייה נחסמת על נעילת השורה, ואחרי
--    ה-COMMIT של הראשונה מעריכה מחדש את התנאי ומקבלת אפס שורות.
--    בלי זה, הוצאה נרשמת פעמיים.

alter table commands add column expires_at timestamptz;

-- חלון האישור: 10 דקות (סעיף 4.3.א).
alter table commands alter column expires_at set default (now() + interval '10 minutes');

create index commands_pending_idx on commands (phone, created_at desc)
  where status = 'pending_confirm';

-- ─────────────── יצירת פקודה ממתינה ───────────────
create or replace function rpc_create_pending_command(
  p_phone text, p_raw_text text, p_parsed jsonb, p_intent text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  -- פקודה ממתינה קודמת מאותו מספר מבוטלת: הודעה חדשה מחליפה אותה
  -- (סעיף 4.3.א — "טקסט אחר → סמן את הקודמת cancelled").
  update commands set status = 'cancelled'
   where phone = p_phone and status = 'pending_confirm';

  insert into commands (phone, raw_text, parsed, intent, status)
  values (p_phone, p_raw_text, p_parsed, p_intent, 'pending_confirm')
  returning id into v_id;

  return v_id;
end $$;

-- ─────────────── ביצוע ───────────────
/**
 * מבצע פקודה ממתינה. אטומי מקצה לקצה.
 *
 * מחזיר {ok, reason?, result_table?, result_id?}.
 * reason='already_handled' — מישהו הקדים. זה המצב במרוץ אישורים,
 * והוא **לא** שגיאה: פשוט לא מבצעים שוב.
 */
create or replace function rpc_execute_command(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c            commands;
  f            jsonb;
  v_season     uuid;
  v_branch     uuid;
  v_student    uuid;
  v_table      text;
  v_id         uuid;
  v_before     jsonb;
  v_after      jsonb;
begin
  -- ★ התפיסה האטומית. שורה אחת בלבד תצא מכאן, גם אם עשרה תהליכים
  --   קוראים לפונקציה בו זמנית.
  update commands
     set status = 'applied', confirmed_at = now()
   where id = p_command_id
     and status = 'pending_confirm'
     and (expires_at is null or expires_at > now())
  returning * into c;

  if not found then
    -- למה לא: כבר טופלה, או שפג תוקפה.
    select * into c from commands where id = p_command_id;
    if c.id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if c.status = 'pending_confirm' then
      return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_handled', 'status', c.status);
  end if;

  f := coalesce(c.parsed -> 'fields', '{}'::jsonb);
  select id into v_season from seasons where is_current;

  if c.intent in ('expense', 'income') then
    if f ? 'branch' and f ->> 'branch' is not null then
      select id into v_branch from branches
       where name = f ->> 'branch' and deleted_at is null;
    end if;

    insert into ledger_entries (season_id, kind, scope, branch_id, entry_date, category,
                                vendor, description, amount, source)
    values (v_season, c.intent::entry_kind,
            case when v_branch is not null then 'branch' else 'general' end::entry_scope,
            v_branch,
            coalesce((f ->> 'date')::date, current_date),
            coalesce(f ->> 'category', 'אחר'),
            f ->> 'vendor', f ->> 'description',
            (f ->> 'amount')::numeric, 'whatsapp')
    returning id into v_id;
    v_table := 'ledger_entries';
    select to_jsonb(l) into v_after from ledger_entries l where l.id = v_id;

  elsif c.intent = 'payment' then
    select id into v_student from students
     where full_name = f ->> 'student_name' and deleted_at is null limit 1;
    if v_student is null then
      raise exception 'לא נמצאה תלמידה בשם %', f ->> 'student_name';
    end if;

    insert into payments (student_id, paid_on, amount, method, source)
    values (v_student, coalesce((f ->> 'date')::date, current_date),
            (f ->> 'amount')::numeric,
            coalesce((f ->> 'method')::payment_method, 'cash'), 'whatsapp')
    returning id into v_id;
    v_table := 'payments';
    select to_jsonb(p) into v_after from payments p where p.id = v_id;

  elsif c.intent = 'new_student' then
    select id into v_branch from branches
     where name = f ->> 'branch' and deleted_at is null;
    if v_branch is null then
      raise exception 'לא נמצא סניף בשם %', f ->> 'branch';
    end if;

    insert into students (season_id, branch_id, full_name, grade, parent_name,
                          parent_phone, tuition_total, source)
    values (v_season, v_branch, f ->> 'full_name', f ->> 'grade', f ->> 'parent_name',
            f ->> 'parent_phone',
            coalesce((f ->> 'tuition')::numeric,
                     (select default_tuition from branches where id = v_branch)),
            'whatsapp')
    returning id into v_id;
    v_table := 'students';
    select to_jsonb(s) into v_after from students s where s.id = v_id;

  elsif c.intent = 'update_student' then
    select id into v_student from students
     where full_name = f ->> 'student_name' and deleted_at is null limit 1;
    if v_student is null then
      raise exception 'לא נמצאה תלמידה בשם %', f ->> 'student_name';
    end if;

    -- ★ שומרים את השורה המלאה לפני. זה מה שמאפשר ביטול אמיתי
    --   ולא ניחוש של הערך הקודם.
    select to_jsonb(s) into v_before from students s where s.id = v_student;

    if f ->> 'field' = 'status' then
      update students set status = (f ->> 'value')::student_status where id = v_student;
    elsif f ->> 'field' = 'grade' then
      update students set grade = f ->> 'value' where id = v_student;
    elsif f ->> 'field' = 'parent_phone' then
      update students set parent_phone = f ->> 'value' where id = v_student;
    elsif f ->> 'field' = 'tuition_total' then
      update students set tuition_total = (f ->> 'value')::numeric where id = v_student;
    elsif f ->> 'field' = 'notes' then
      update students set notes = f ->> 'value' where id = v_student;
    else
      raise exception 'שדה שאינו ניתן לעדכון מוואטסאפ: %', f ->> 'field';
    end if;

    v_table := 'students';
    v_id := v_student;
    select to_jsonb(s) into v_after from students s where s.id = v_student;

  elsif c.intent = 'reminder' then
    insert into reminders (kind, to_phone, to_label, body, scheduled_at)
    values ('general', coalesce(f ->> 'phone', c.phone), f ->> 'target',
            coalesce(f ->> 'body', c.raw_text),
            now() + (coalesce((f ->> 'offset_days')::int, 0) || ' days')::interval)
    returning id into v_id;
    v_table := 'reminders';
    select to_jsonb(r) into v_after from reminders r where r.id = v_id;

  else
    raise exception 'כוונה שאינה ניתנת לביצוע: %', c.intent;
  end if;

  update commands set result_table = v_table, result_id = v_id where id = c.id;

  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (c.phone, case when v_before is null then 'insert' else 'update' end,
          v_table, v_id, v_before, v_after, 'whatsapp');

  return jsonb_build_object('ok', true, 'result_table', v_table, 'result_id', v_id,
                            'command_id', c.id);
end $$;

-- ─────────────── ביטול ───────────────
/**
 * מבטל פקודה שבוצעה ומחזיר את המסד למצב הקודם.
 *
 * לכל intent יש היפוך: מחיקה רכה לרשומות שנוצרו, והחזרת השורה
 * המלאה מ-audit_log.before לעדכונים. חלון: 24 שעות.
 */
create or replace function rpc_cancel_command(p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c commands; v_before jsonb; v_rows int;
begin
  -- ★ אותה תפיסה אטומית: ביטול כפול לא יבטל פעמיים.
  update commands set status = 'cancelled'
   where id = p_command_id
     and status = 'applied'
     and created_at > now() - interval '24 hours'
  returning * into c;

  if not found then
    select * into c from commands where id = p_command_id;
    if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if c.status = 'applied' then
      return jsonb_build_object('ok', false, 'reason', 'too_old',
        'message', 'הפעולה ישנה מדי לביטול אוטומטי, אפשר לתקן במערכת.');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_applied', 'status', c.status);
  end if;

  if c.result_id is null then
    return jsonb_build_object('ok', true, 'reversed', 'nothing');
  end if;

  if c.result_table = 'ledger_entries' then
    update ledger_entries set deleted_at = now() where id = c.result_id;
  elsif c.result_table = 'payments' then
    update payments set deleted_at = now() where id = c.result_id;
  elsif c.result_table = 'reminders' then
    update reminders set status = 'cancelled' where id = c.result_id;
  elsif c.result_table = 'students' then
    if c.intent = 'new_student' then
      update students set deleted_at = now() where id = c.result_id;
    else
      -- ★ החזרת הערכים מהשורה שנשמרה לפני העדכון.
      select before into v_before from audit_log
       where table_name = 'students' and row_id = c.result_id and source = 'whatsapp'
         and before is not null
       order by created_at desc limit 1;

      if v_before is null then
        return jsonb_build_object('ok', false, 'reason', 'no_snapshot',
          'message', 'לא נשמר מצב קודם, אפשר לתקן במערכת.');
      end if;

      update students s set
        status        = (v_before ->> 'status')::student_status,
        grade         = v_before ->> 'grade',
        parent_phone  = v_before ->> 'parent_phone',
        tuition_total = (v_before ->> 'tuition_total')::numeric,
        notes         = v_before ->> 'notes'
      where s.id = c.result_id;
    end if;
  end if;

  get diagnostics v_rows = row_count;

  insert into audit_log (actor, action, table_name, row_id, before, after, source)
  values (c.phone, 'delete', c.result_table, c.result_id,
          jsonb_build_object('cancelled_command', c.id), null, 'whatsapp');

  return jsonb_build_object('ok', true, 'reversed', c.result_table, 'rows', v_rows);
end $$;

/** ביטול הפקודה האחרונה שבוצעה מהמספר הזה — הטקסט "בטל" (סעיף 4.3.ב). */
create or replace function rpc_cancel_last_command(p_phone text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from commands
   where phone = p_phone and status = 'applied'
     and created_at > now() - interval '24 hours'
   order by confirmed_at desc nulls last, created_at desc
   limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_cancel',
      'message', 'אין פעולה אחרונה לביטול.');
  end if;
  return rpc_cancel_command(v_id);
end $$;

revoke all on function rpc_create_pending_command(text, text, jsonb, text) from public, anon;
revoke all on function rpc_execute_command(uuid)      from public, anon;
revoke all on function rpc_cancel_command(uuid)       from public, anon;
revoke all on function rpc_cancel_last_command(text)  from public, anon;
