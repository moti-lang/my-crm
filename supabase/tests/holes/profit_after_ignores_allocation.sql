-- חור: "אחרי הקצאה" שווה ל"לפני". הדוח מציג שני מספרים זהים.
create or replace view v_branch_profitability as
select b.branch_id, b.name, b.active_students, b.income_students, b.income_other, b.expenses, b.open_debt,
       b.income_students + b.income_other - b.expenses as profit_before,
       coalesce(a.allocated_amount, 0) as allocated,
       b.income_students + b.income_other - b.expenses as profit_after
from v_branch_pnl b left join v_general_allocation a on a.branch_id = b.branch_id
where auth_role() in ('owner','accountant');
alter view v_branch_profitability set (security_invoker = false);
