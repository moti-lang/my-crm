-- 0015_productions_reports.sql — סבב 8: הפקות ודוחות.
--
-- ארבע תצוגות דוח, כולן כספיות, כולן לפי אותו כלל שנלמד ב-0008 ו-0009:
-- דוח כספי אינו נשען על RLS של טבלה עם מידע אישי. הסינון לפי תפקיד
-- כתוב במפורש בתצוגה, security_invoker=false, ו-05_role_consistency
-- מוכיח שהבעלים ורואת החשבון רואות אותם מספרים.
--
-- מנהלת סניף אינה רואה אף אחת מהן: הן כוללות הפקות, הנהלה וסניפים
-- אחרים. עדיף כלום על פני מספר חלקי.

-- ─────────── רווח לפי הפקה ───────────
create view v_production_pnl as
select p.id as production_id, p.name, p.year, p.status, p.budget, p.release_date, p.notes,
       coalesce(x.expenses, 0)                        as expenses,
       coalesce(x.income, 0)                          as income,
       coalesce(x.income, 0) - coalesce(x.expenses, 0) as profit,
       case when coalesce(p.budget, 0) > 0
            then round(100.0 * coalesce(x.expenses, 0) / p.budget)
            else null end                             as budget_used_pct,
       coalesce(c.cast_count, 0)                      as cast_count,
       p.created_at
from productions p
left join (
  select production_id,
         sum(amount) filter (where kind = 'expense') as expenses,
         sum(amount) filter (where kind = 'income')  as income
  from ledger_entries
  where scope = 'production' and deleted_at is null
  group by production_id
) x on x.production_id = p.id
left join (
  select production_id, count(*) as cast_count from production_cast group by production_id
) c on c.production_id = p.id
where p.deleted_at is null
  and auth_role() in ('owner', 'accountant');
alter view v_production_pnl set (security_invoker = false);

-- ─────────── רווח והפסד לפי חודש ───────────
-- הכנסות מתלמידות לפי תאריך התשלום; ספר הכספים לפי תאריך הרשומה.
-- העונה של תשלום היא העונה של התלמידה.
create view v_pnl_monthly as
with months as (
  select s.season_id, date_trunc('month', p.paid_on)::date as month,
         sum(p.amount) as income_students, 0::numeric as income_other,
         0::numeric as expenses, 0::numeric as expenses_branch,
         0::numeric as expenses_general, 0::numeric as expenses_production
  from payments p join students s on s.id = p.student_id
  where p.deleted_at is null and s.deleted_at is null
  group by s.season_id, date_trunc('month', p.paid_on)
  union all
  select l.season_id, date_trunc('month', l.entry_date)::date,
         0, sum(l.amount) filter (where l.kind = 'income'),
         sum(l.amount) filter (where l.kind = 'expense'),
         sum(l.amount) filter (where l.kind = 'expense' and l.scope = 'branch'),
         sum(l.amount) filter (where l.kind = 'expense' and l.scope = 'general'),
         sum(l.amount) filter (where l.kind = 'expense' and l.scope = 'production')
  from ledger_entries l
  where l.deleted_at is null
  group by l.season_id, date_trunc('month', l.entry_date)
)
select season_id, month,
       coalesce(sum(income_students), 0)    as income_students,
       coalesce(sum(income_other), 0)       as income_other,
       coalesce(sum(expenses), 0)           as expenses,
       coalesce(sum(expenses_branch), 0)    as expenses_branch,
       coalesce(sum(expenses_general), 0)   as expenses_general,
       coalesce(sum(expenses_production), 0) as expenses_production,
       coalesce(sum(income_students), 0) + coalesce(sum(income_other), 0)
         - coalesce(sum(expenses), 0)       as profit
from months
where auth_role() in ('owner', 'accountant')
group by season_id, month;
alter view v_pnl_monthly set (security_invoker = false);

-- ─────────── רווחיות לפי סניף, לפני ואחרי הקצאת הנהלה ───────────
create view v_branch_profitability as
select b.branch_id, b.name, b.active_students,
       b.income_students, b.income_other, b.expenses, b.open_debt,
       b.income_students + b.income_other - b.expenses                         as profit_before,
       coalesce(a.allocated_amount, 0)                                          as allocated,
       b.income_students + b.income_other - b.expenses - coalesce(a.allocated_amount, 0) as profit_after
from v_branch_pnl b
left join v_general_allocation a on a.branch_id = b.branch_id
where auth_role() in ('owner', 'accountant');
alter view v_branch_profitability set (security_invoker = false);

-- ─────────── המרת פניות לתלמידות ───────────
-- ליד = תלמידה שנוצרה מוואטסאפ (source='whatsapp'). לפי חודש היצירה
-- בשעון ישראל, כמו כל תצוגה במערכת.
create view v_lead_funnel as
select date_trunc('month', s.created_at at time zone 'Asia/Jerusalem')::date as month,
       count(*)                                          as leads,
       count(*) filter (where s.status = 'active')       as converted,
       count(*) filter (where s.status = 'pending')      as pending,
       count(*) filter (where s.status in ('stopped', 'graduated')) as lost,
       case when count(*) > 0
            then round(100.0 * count(*) filter (where s.status = 'active') / count(*))
            else 0 end                                   as conversion_pct
from students s
where s.source = 'whatsapp' and s.deleted_at is null
  and auth_role() in ('owner', 'accountant')
group by 1;
alter view v_lead_funnel set (security_invoker = false);

-- ─────────── הרשאות ───────────
revoke all on v_production_pnl, v_pnl_monthly, v_branch_profitability, v_lead_funnel from anon, public;
grant select on v_production_pnl, v_pnl_monthly, v_branch_profitability, v_lead_funnel to authenticated;
