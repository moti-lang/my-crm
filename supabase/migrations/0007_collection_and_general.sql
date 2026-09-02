-- 0007 — מה שסבב 3 צריך מהמסד.

-- ─────────── חלוקת ההוצאות הכלליות של העונה הנוכחית ───────────
-- עוטף את f_general_allocation כ-view, כדי שהמסך יקרא ממנה ולא ישכפל
-- את החישוב בצד הלקוח. חישוב כספי חי במקום אחד בלבד.
create view v_general_allocation as
select a.branch_id, b.name as branch_name, a.allocated_amount
from seasons s
cross join lateral f_general_allocation(s.id) a
join branches b on b.id = a.branch_id
where s.is_current;

alter view v_general_allocation set (security_invoker = true);
revoke all on v_general_allocation from anon;
grant select on v_general_allocation to authenticated;

-- ─────────── ותק חוב לגבייה ───────────
-- הימים נמדדים מהתשלום האחרון; מי שלא שילמה מעולם — מיום ההצטרפות.
-- הסיווג ל-30/60/90 נעשה כאן ולא במסך, כדי שכל דוח יראה את אותו מספר.
create view v_debtors as
select
  vb.student_id,
  vb.full_name,
  vb.branch_id,
  b.name as branch_name,
  s.parent_name,
  s.parent_phone,
  s.status,
  vb.due,
  vb.paid,
  vb.balance,
  vb.last_paid_on,
  coalesce(vb.last_paid_on, s.joined_on) as aging_from,
  (current_date - coalesce(vb.last_paid_on, s.joined_on)) as days_outstanding,
  case
    when (current_date - coalesce(vb.last_paid_on, s.joined_on)) >= 90 then 90
    when (current_date - coalesce(vb.last_paid_on, s.joined_on)) >= 60 then 60
    when (current_date - coalesce(vb.last_paid_on, s.joined_on)) >= 30 then 30
    else 0
  end as aging_bucket
from v_student_balance vb
join students s on s.id = vb.student_id
join branches b on b.id = vb.branch_id
where vb.balance > 0
  and s.deleted_at is null
  and s.status in ('active', 'pending');

alter view v_debtors set (security_invoker = true);
revoke all on v_debtors from anon;
grant select on v_debtors to authenticated;
