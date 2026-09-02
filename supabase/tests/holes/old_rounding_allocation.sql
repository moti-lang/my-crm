-- חור מכוון: הגרסה הישנה של f_general_allocation, שמעגלת פר סניף
-- בלי לתקן את השארית. משמשת רק את בקרת השלילה.
create or replace function f_general_allocation(p_season uuid)
returns table (branch_id uuid, allocated_amount numeric)
language sql stable as $$
  with active_branches as (
    select b.id,
           (select count(*) from students s
             where s.branch_id=b.id and s.status='active' and s.deleted_at is null
               and s.season_id=p_season) as students
    from branches b where b.deleted_at is null and b.is_active
  ),
  totals as (
    select (select count(*) from active_branches) as n_branches,
           (select nullif(sum(students),0) from active_branches) as n_students
  ),
  entries as (
    select l.id, l.amount, l.split_method, l.split_manual
    from ledger_entries l
    where l.scope='general' and l.kind='expense'
      and l.deleted_at is null and l.season_id=p_season
  )
  select ab.id,
         round(coalesce(sum(
           case e.split_method
             when 'equal'       then e.amount / nullif(t.n_branches,0)
             when 'by_students' then e.amount * ab.students::numeric / nullif(t.n_students,0)
             when 'manual'      then e.amount * coalesce((e.split_manual ->> ab.id::text)::numeric, 0)
             else 0
           end
         ),0), 2)
  from active_branches ab
  cross join totals t
  left join entries e on true
  group by ab.id;
$$;
