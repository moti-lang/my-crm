-- 0008 — f_general_allocation חייבת לרוץ על מלוא הנתונים.
--
-- הבאג: הפונקציה הייתה stable רגילה, כלומר רצה בהרשאות הקורא.
-- לרואת חשבון אין פוליסה על students, ולכן משקלי by_students יצאו אפס
-- וההוצאה הזו פשוט נעלמה מהחלוקה. היא ראתה 8,400 במקום 12,000 —
-- מספר כספי שגוי שמוצג כאילו הוא נכון. הבעלים והרואת חשבון היו רואות
-- רווח שונה לאותו סניף.
--
-- התיקון: security definer, כדי שהחישוב תמיד ייעשה על מלוא הנתונים.
-- זה בטוח כי הפלט הוא אגרגט ברמת סניף בלבד — אין בו שום פרט אישי.
-- הבקרה על מי רואה אותו עוברת ל-view, במקום להיווצר כתופעת לוואי
-- של RLS על טבלה אחרת.
create or replace function f_general_allocation(p_season uuid)
returns table (branch_id uuid, allocated_amount numeric)
language sql stable
security definer
set search_path = public, pg_temp
as $$
  with active_branches as (
    select b.id,
           (select count(*) from students s
             where s.branch_id = b.id and s.status = 'active' and s.deleted_at is null
               and s.season_id = p_season) as students
    from branches b
    where b.deleted_at is null and b.is_active
  ),
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
             when 'by_students' then ab.students::numeric
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
$$;

revoke all on function f_general_allocation(uuid) from public, anon;
grant execute on function f_general_allocation(uuid) to authenticated;

-- הבקרה עוברת ל-view: בעלים ורואת חשבון בלבד.
-- מנהלת סניף מקבלת אפס שורות — עדיף כלום על פני מספר שגוי.
create or replace view v_general_allocation as
select a.branch_id, b.name as branch_name, a.allocated_amount
from seasons s
cross join lateral f_general_allocation(s.id) a
join branches b on b.id = a.branch_id
where s.is_current
  and auth_role() in ('owner', 'accountant');

-- security_invoker=false: ה-view רץ בהרשאות הבעלים שלו, והסינון הפנימי
-- לפי auth_role() הוא מה שמגביל. אחרת ה-join ל-branches היה מסתיר שורות.
alter view v_general_allocation set (security_invoker = false);
revoke all on v_general_allocation from anon;
grant select on v_general_allocation to authenticated;
