-- 0009 — דוחות כספיים מחזירים אותם מספרים לכל מי שרשאי לראותם.
--
-- הבאג, מאותו שורש כמו 0008: התצוגות הכספיות היו security_invoker=true,
-- כלומר נשענו על RLS של students. לרואת חשבון אין פוליסה על students
-- (בכוונה — יש שם טלפונים וכתובות), ולכן היא ראתה:
--
--   הכנסות מתלמידות    0     במקום  20,700
--   חוב פתוח           0     במקום  20,600
--   תלמידות פעילות     0     במקום  19
--   חייבות             0     במקום  12
--
-- כלומר דוח רווח והפסד עם אפס הכנסות — בדיוק התפקיד שלה. המספרים לא
-- היו חסרים, הם היו שגויים ומוצגים כאילו הם נכונים.
--
-- הכלל שנגזר מכאן: **דוח כספי לא נשען על RLS של טבלה שמכילה מידע אישי.**
-- הסינון נכתב במפורש בתצוגה, והמידע האישי ממוסך לפי תפקיד.
-- 05_role_consistency_proof.sql אוכף את זה על כל דוח.

-- ─────────────── יתרות תלמידות ───────────────
drop view if exists v_debtors;
drop view if exists v_branch_pnl;
drop view if exists v_student_balance cascade;

create view v_student_balance as
select s.id as student_id, s.branch_id, s.season_id, s.full_name,
       (s.tuition_total - s.discount) as due,
       coalesce(p.paid, 0) as paid,
       (s.tuition_total - s.discount) - coalesce(p.paid, 0) as balance,
       p.last_paid_on
from students s
left join (
  select student_id, sum(amount) as paid, max(paid_on) as last_paid_on
  from payments where deleted_at is null group by student_id
) p on p.student_id = s.id
where s.deleted_at is null
  and (
    auth_role() in ('owner', 'accountant')
    or (auth_role() = 'branch_manager' and s.branch_id in (select my_branches()))
  );

-- security_invoker=false בכוונה: התצוגה לא יכולה להישען על RLS של
-- students, כי הפרדת ה-PII שם היא בדיוק מה שמעוות את המספרים.
-- הסינון למעלה הוא אותה לוגיקה, כתובה במפורש ונבדקת.
alter view v_student_balance set (security_invoker = false);

-- ─────────────── רווחיות לפי סניף ───────────────
create view v_branch_pnl as
select b.id as branch_id, b.name,
  (select coalesce(sum(vb.paid),0) from v_student_balance vb where vb.branch_id=b.id) as income_students,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='income' and l.scope='branch' and l.deleted_at is null) as income_other,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='expense' and l.scope='branch' and l.deleted_at is null) as expenses,
  (select coalesce(sum(vb.balance),0) from v_student_balance vb where vb.branch_id=b.id) as open_debt,
  (select count(*) from students s
     where s.branch_id=b.id and s.status='active' and s.deleted_at is null) as active_students
from branches b
where b.deleted_at is null
  and (
    auth_role() in ('owner', 'accountant')
    or (auth_role() = 'branch_manager' and b.id in (select my_branches()))
  );

alter view v_branch_pnl set (security_invoker = false);

-- ─────────────── חייבות ───────────────
-- המספרים זהים לכל התפקידים; הטלפון ממוסך לרואת חשבון.
-- אותו סך חוב, בלי לחשוף לה מספרי טלפון של הורים.
create view v_debtors as
select
  vb.student_id,
  vb.full_name,
  vb.branch_id,
  b.name as branch_name,
  s.parent_name,
  case when auth_role() = 'accountant' then null else s.parent_phone end as parent_phone,
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

alter view v_debtors set (security_invoker = false);

revoke all on v_student_balance, v_branch_pnl, v_debtors from anon;
grant select on v_student_balance, v_branch_pnl, v_debtors to authenticated;
