-- חור: רווח ההפקה סופר גם רשומות שנמחקו רכה.
create or replace view v_production_pnl as
select p.id as production_id, p.name, p.year, p.status, p.budget, p.release_date, p.notes,
       coalesce(x.expenses, 0) as expenses, coalesce(x.income, 0) as income,
       coalesce(x.income, 0) - coalesce(x.expenses, 0) as profit,
       case when coalesce(p.budget, 0) > 0 then round(100.0 * coalesce(x.expenses, 0) / p.budget) else null end as budget_used_pct,
       coalesce(c.cast_count, 0) as cast_count, p.created_at
from productions p
left join (select production_id, sum(amount) filter (where kind='expense') as expenses,
                  sum(amount) filter (where kind='income') as income
           from ledger_entries where scope='production' group by production_id) x on x.production_id = p.id
left join (select production_id, count(*) as cast_count from production_cast group by production_id) c on c.production_id = p.id
where p.deleted_at is null and auth_role() in ('owner','accountant');
alter view v_production_pnl set (security_invoker = false);
