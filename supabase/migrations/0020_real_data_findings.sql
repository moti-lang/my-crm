-- 0020 — ממצאי סבב הנתונים האמיתיים (14_real_data.sql):
--   3. הוצאה כללית "לפי תלמידות" כשאין תלמידות פעילות (חופשה) — נופלת
--      לחלוקה שווה במקום להיעלם מרווחיות הסניפים.
--   4. תשלום נושא את הסניף שבו נרשם: מעבר תלמידה בין סניפים לא משכתב
--      את ההיסטוריה של הסניף הישן.
--   5. סגירת סניף: rpc_close_branch — הבעלים בלבד, רק כשאין בו תלמידות
--      פעילות/ממתינות; מכבה את הסניף ואת קישור הנוכחות שלו.

-- ─── 3. חלוקה "לפי תלמידות" בלי תלמידות → שווה ───
create or replace function f_general_allocation(p_season uuid)
 RETURNS TABLE(branch_id uuid, allocated_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with active_branches as (
    select b.id,
           (select count(*) from students s
             where s.branch_id = b.id and s.status = 'active' and s.deleted_at is null
               and s.season_id = p_season) as students
    from branches b
    where b.deleted_at is null and b.is_active
  ),
  totals as (select sum(students) as students from active_branches),
  entries as (
    select l.id, l.amount, l.split_method, l.split_manual
    from ledger_entries l
    where l.scope = 'general' and l.kind = 'expense'
      and l.deleted_at is null and l.season_id = p_season
      and l.split_method <> 'none'
  ),
  weights as (
    select e.id as entry_id, e.amount, ab.id as branch_id,
           case e.split_method
             when 'equal'       then 1::numeric
             -- אין תלמידות פעילות בכלל (חופשה): חלוקה שווה, לא אפס.
             when 'by_students' then case when (select students from totals) > 0 then ab.students::numeric else 1::numeric end
             when 'manual'      then coalesce((e.split_manual ->> ab.id::text)::numeric, 0)
             else 0::numeric
           end as w
    from entries e
    cross join active_branches ab
  ),
  rounded as (
    select entry_id, branch_id, amount,
           sum(w) over (partition by entry_id) as w_total,
           case when sum(w) over (partition by entry_id) > 0
                then round(amount * w / sum(w) over (partition by entry_id), 2)
                else 0 end as share
    from weights
  ),
  ranked as (
    select r.*,
           row_number() over (partition by entry_id order by share desc, branch_id) as rn,
           sum(share)   over (partition by entry_id) as share_total
    from rounded r
  ),
  adjusted as (
    select branch_id,
           sum(share + case when rn = 1 and w_total > 0 then amount - share_total else 0 end) as total
    from ranked
    group by branch_id
  )
  select ab.id, coalesce(a.total, 0)
  from active_branches ab
  left join adjusted a on a.branch_id = ab.id;
$function$;

-- ─── 4. תשלום נושא סניף ───
alter table payments add column if not exists branch_id uuid references branches(id);
update payments p set branch_id = s.branch_id from students s where s.id = p.student_id and p.branch_id is null;
create index if not exists payments_branch_idx on payments(branch_id) where deleted_at is null;

create or replace function f_payment_branch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- הסניף של התלמידה ברגע הרישום. מעבר סניף אחר כך לא נוגע בזה.
  if new.branch_id is null then
    select branch_id into new.branch_id from students where id = new.student_id;
  end if;
  return new;
end $$;
revoke all on function f_payment_branch() from public, anon, authenticated;
drop trigger if exists payments_branch on payments;
create trigger payments_branch before insert on payments for each row execute function f_payment_branch();

create or replace view v_branch_pnl as
select b.id as branch_id, b.name,
  (select coalesce(sum(p.amount),0) from payments p
     join students s on s.id = p.student_id
     where p.branch_id = b.id and p.deleted_at is null and s.deleted_at is null) as income_students,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='income' and l.scope='branch' and l.deleted_at is null) as income_other,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='expense' and l.scope='branch' and l.deleted_at is null) as expenses,
  (select coalesce(sum(greatest(vb.balance, 0)),0) from v_student_balance vb where vb.branch_id=b.id) as open_debt,
  (select count(*) from students s
     where s.branch_id=b.id and s.status='active' and s.deleted_at is null) as active_students
from branches b
where b.deleted_at is null
  and (
    auth_role() in ('owner', 'accountant')
    or (auth_role() = 'branch_manager' and b.id in (select my_branches()))
  );
alter view v_branch_pnl set (security_invoker = false);

-- ─── 5. סגירת סניף ───
create or replace function rpc_close_branch(p_branch uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
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
end $$;
revoke all on function rpc_close_branch(uuid) from public, anon;
grant execute on function rpc_close_branch(uuid) to authenticated;
