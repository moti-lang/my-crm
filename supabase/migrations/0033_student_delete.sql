-- 0033 — מחיקת תלמידה (רכה), שחזור ומחיקה סופית.
--
-- ★ החשבונאות: תשלום הוא רשומה עצמאית. מחיקת תלמידה מסתירה את הכרטיס — לא את
--   התשלומים. הם נשארים בדוחות בסכום, בתאריך ובסניף שבהם נרשמו (כמו בקבלה של SUMIT).
--   עד עכשיו v_pnl_monthly ו-v_branch_pnl סיננו s.deleted_at IS NULL — כלומר מחיקת
--   תלמידה הייתה משנה הכנסות של חודש סגור. הסינון הוסר.
-- ★ במסד: אי אפשר למחוק פיזית תלמידה עם תשלומים, נוכחות, הפקות או הוראות קבע
--   (המפתחות היו ON DELETE CASCADE — מחיקה הייתה מוחקת גם את התשלומים).
-- · מחיקה: קישורי תשלום פתוחים ותזכורות מתוזמנות מתבטלים. הוראת קבע פעילה — חוסמת.
-- · יתרת חוב של תלמידה מחוקה יוצאת מ"חוב פתוח" (הכרטיס מוסתר); ההכנסות לא זזות.

alter table payments drop constraint payments_student_id_fkey,
  add constraint payments_student_id_fkey foreign key (student_id) references students(id) on delete restrict;
alter table attendance drop constraint attendance_student_id_fkey,
  add constraint attendance_student_id_fkey foreign key (student_id) references students(id) on delete restrict;
alter table production_cast drop constraint production_cast_student_id_fkey,
  add constraint production_cast_student_id_fkey foreign key (student_id) references students(id) on delete restrict;
alter table standing_orders drop constraint standing_orders_student_id_fkey,
  add constraint standing_orders_student_id_fkey foreign key (student_id) references students(id) on delete restrict;
alter table conversations drop constraint conversations_student_id_fkey,
  add constraint conversations_student_id_fkey foreign key (student_id) references students(id) on delete set null;

create or replace view v_pnl_monthly with (security_invoker = false) as
WITH months AS (
         SELECT s.season_id,
            date_trunc('month'::text, p.paid_on::timestamp with time zone)::date AS month,
            sum(p.amount) AS income_students,
            0::numeric AS income_other,
            0::numeric AS expenses,
            0::numeric AS expenses_branch,
            0::numeric AS expenses_general,
            0::numeric AS expenses_production
           FROM payments p
             JOIN students s ON s.id = p.student_id
          WHERE p.deleted_at IS NULL
          GROUP BY s.season_id, (date_trunc('month'::text, p.paid_on::timestamp with time zone))
        UNION ALL
         SELECT l.season_id,
            date_trunc('month'::text, l.entry_date::timestamp with time zone)::date AS date_trunc,
            0,
            sum(l.amount) FILTER (WHERE l.kind = 'income'::entry_kind) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind AND l.scope = 'branch'::entry_scope) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind AND l.scope = 'general'::entry_scope) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind AND l.scope = 'production'::entry_scope) AS sum
           FROM ledger_entries l
          WHERE l.deleted_at IS NULL
          GROUP BY l.season_id, (date_trunc('month'::text, l.entry_date::timestamp with time zone))
        )
 SELECT season_id,
    month,
    COALESCE(sum(income_students), 0::numeric) AS income_students,
    COALESCE(sum(income_other), 0::numeric) AS income_other,
    COALESCE(sum(expenses), 0::numeric) AS expenses,
    COALESCE(sum(expenses_branch), 0::numeric) AS expenses_branch,
    COALESCE(sum(expenses_general), 0::numeric) AS expenses_general,
    COALESCE(sum(expenses_production), 0::numeric) AS expenses_production,
    COALESCE(sum(income_students), 0::numeric) + COALESCE(sum(income_other), 0::numeric) - COALESCE(sum(expenses), 0::numeric) AS profit
   FROM months
  WHERE auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])
  GROUP BY season_id, month;

create or replace view v_branch_pnl with (security_invoker = false) as
SELECT id AS branch_id,
    name,
    ( SELECT COALESCE(sum(p.amount), 0::numeric) AS "coalesce"
           FROM payments p
             JOIN students s ON s.id = p.student_id
          WHERE p.branch_id = b.id AND p.deleted_at IS NULL) AS income_students,
    ( SELECT COALESCE(sum(LEAST(pp.paid, s.registration_fee)), 0::numeric) AS "coalesce"
           FROM students s
             JOIN ( SELECT payments.student_id, sum(payments.amount) AS paid
                      FROM payments WHERE payments.deleted_at IS NULL GROUP BY payments.student_id) pp ON pp.student_id = s.id
          WHERE s.branch_id = b.id) AS income_registration_fees,
    ( SELECT COALESCE(sum(l.amount), 0::numeric) AS "coalesce"
           FROM ledger_entries l
          WHERE l.branch_id = b.id AND l.kind = 'income'::entry_kind AND l.scope = 'branch'::entry_scope AND l.deleted_at IS NULL) AS income_other,
    ( SELECT COALESCE(sum(l.amount), 0::numeric) AS "coalesce"
           FROM ledger_entries l
          WHERE l.branch_id = b.id AND l.kind = 'expense'::entry_kind AND l.scope = 'branch'::entry_scope AND l.deleted_at IS NULL) AS expenses,
    ( SELECT COALESCE(sum(GREATEST(vb.balance, 0::numeric)), 0::numeric) AS "coalesce"
           FROM v_student_balance vb
          WHERE vb.branch_id = b.id) AS open_debt,
    ( SELECT count(*) AS count
           FROM students s
          WHERE s.branch_id = b.id AND s.status = 'active'::student_status AND s.deleted_at IS NULL) AS active_students
   FROM branches b
  WHERE deleted_at IS NULL AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (id IN ( SELECT my_branches() AS my_branches)));

-- ★ אין קישור תשלום חדש לתלמידה מחוקה (כפתור ישן במסך, פקודה, סנכרון).
create or replace function f_no_link_for_deleted() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from students where id = new.student_id and deleted_at is not null) then
    raise exception 'התלמידה נמחקה — אין קישור תשלום';
  end if;
  return new;
end $$;
revoke all on function f_no_link_for_deleted() from public, anon, authenticated;
drop trigger if exists payment_links_no_deleted on payment_links;
create trigger payment_links_no_deleted before insert on payment_links
  for each row execute function f_no_link_for_deleted();

/** מחיקה רכה. בעלים בלבד. התשלומים והנוכחות לא נוגעים. */
create or replace function rpc_delete_student(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_links int; v_rem int;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה למחוק תלמידה' using errcode = '42501'; end if;
  select * into s from students where id = p_student and deleted_at is null for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה'; end if;
  if exists (select 1 from standing_orders where student_id = s.id and status in ('active', 'retrying')) then
    raise exception 'יש הוראת קבע פעילה, צריך לעצור אותה קודם';
  end if;
  update payment_links set status = 'cancelled' where student_id = s.id and status in ('pending', 'opened');
  get diagnostics v_links = row_count;
  update reminders set status = 'cancelled', error = 'התלמידה נמחקה' where student_id = s.id and status = 'scheduled';
  get diagnostics v_rem = row_count;
  update students set deleted_at = now() where id = s.id;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'soft_delete', 'students', s.id,
          jsonb_build_object('name', s.full_name, 'links_cancelled', v_links, 'reminders_cancelled', v_rem));
  return jsonb_build_object('ok', true, 'links_cancelled', v_links, 'reminders_cancelled', v_rem);
end $$;

/** שחזור. קישורים ותזכורות שבוטלו נשארים מבוטלים. */
create or replace function rpc_restore_student(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype;
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה לשחזר תלמידה' using errcode = '42501'; end if;
  select * into s from students where id = p_student and deleted_at is not null for update;
  if s.id is null then raise exception 'התלמידה לא נמצאה ברשימת המחוקות'; end if;
  update students set deleted_at = null where id = s.id;
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'restore', 'students', s.id, jsonb_build_object('name', s.full_name));
  return jsonb_build_object('ok', true);
end $$;

/** למה אי אפשר למחוק סופית (ריק = אפשר). */
create or replace function f_purge_blockers(p_student uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(array[
    case when exists (select 1 from payments where student_id = p_student) then 'יש תשלומים' end,
    case when exists (select 1 from attendance where student_id = p_student) then 'יש נוכחות' end,
    case when exists (select 1 from production_cast where student_id = p_student) then 'משובצת בהפקה' end,
    case when exists (select 1 from standing_orders where student_id = p_student) then 'יש הוראת קבע' end,
    case when exists (select 1 from payment_links where student_id = p_student and status in ('paid', 'mismatch')) then 'יש קישור תשלום ששולם' end
  ], null)
$$;
revoke all on function f_purge_blockers(uuid) from public, anon, authenticated;

create or replace function rpc_deleted_students() returns table (
  id uuid, full_name text, branch_name text, parent_phone text, deleted_at timestamptz, paid numeric, purge_blockers text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים רואה תלמידות מחוקות' using errcode = '42501'; end if;
  return query
    select s.id, s.full_name, b.name, s.parent_phone, s.deleted_at,
           coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0),
           f_purge_blockers(s.id)
      from students s join branches b on b.id = s.branch_id
     where s.deleted_at is not null
     order by s.deleted_at desc;
end $$;

/** מחיקה סופית — רק לתלמידה שכבר נמחקה, ובלי שום היסטוריה. */
create or replace function rpc_purge_student(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_block text[];
begin
  if auth_role() is distinct from 'owner' then raise exception 'רק הבעלים יכולה למחוק סופית' using errcode = '42501'; end if;
  select * into s from students where id = p_student and deleted_at is not null for update;
  if s.id is null then raise exception 'מחיקה סופית רק לתלמידה שכבר נמחקה (ברשימת המחוקות)'; end if;
  v_block := f_purge_blockers(s.id);
  if cardinality(v_block) > 0 then
    raise exception 'אי אפשר למחוק סופית: %. אפשר להשאיר אותה מחוקה.', array_to_string(v_block, ', ');
  end if;
  delete from payment_links where student_id = s.id;
  delete from students where id = s.id;   -- תזכורות: cascade; שיחות: student_id מתאפס
  insert into audit_log (actor, action, table_name, row_id, after)
  values ('user:' || coalesce(auth.uid()::text, '?'), 'purge', 'students', s.id, jsonb_build_object('branch_id', s.branch_id));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function rpc_delete_student(uuid), rpc_restore_student(uuid), rpc_deleted_students(), rpc_purge_student(uuid) from public, anon;
grant execute on function rpc_delete_student(uuid), rpc_restore_student(uuid), rpc_deleted_students(), rpc_purge_student(uuid) to authenticated;
