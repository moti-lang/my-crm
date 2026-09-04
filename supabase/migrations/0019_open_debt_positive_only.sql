-- 0019 — החוב הפתוח של סניף סוכם רק חובות. יתרת זכות (תשלום יתר) של
-- תלמידה אחת קיזזה עד עכשיו חובות של אחרות, והמספר במסך הסניפים ובדוח
-- הרווחיות היה נמוך מהאמת. נמצא ב-14_real_data.sql.
create or replace view v_branch_pnl as
select b.id as branch_id, b.name,
  (select coalesce(sum(vb.paid),0) from v_student_balance vb where vb.branch_id=b.id) as income_students,
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
