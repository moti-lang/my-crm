-- 0003 — חלוקת הוצאות כלליות בשיטת השארית הגדולה.
--
-- הבעיה בגרסה הקודמת: round() פר סניף השאיר שארית. 12,000 ש"ח שחולקו
-- שווה בשווה הסתכמו ב-11,999.99. סכום ההקצאות לא נשווה לסכום ההוצאה.
--
-- התיקון: לכל רשומה בנפרד — מעגלים כל הקצאה, מחשבים את ההפרש מול הסכום
-- המקורי, ומוסיפים אותו לסניף בעל ההקצאה הגדולה ביותר (שובר שוויון: branch_id).
-- ההפרש הוא תמיד ברמת אגורות, ולכן ההטיה זניחה ונופלת על מי שממילא נושא הכי הרבה.
--
-- שינוי סמנטי אחד: split_manual מטופל כ*משקלים* ומנורמל לפי סכומם, ולא
-- כשברים שחייבים להסתכם ב-1. עבור {0.3,0.2,0.2,0.15,0.15} התוצאה זהה,
-- אבל קלט כמו {3,2,2} כבר לא מאבד חלק מהסכום בשקט.
create or replace function f_general_allocation(p_season uuid)
returns table (branch_id uuid, allocated_amount numeric)
language sql stable as $$
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
  -- משקל גולמי לכל צירוף רשומה/סניף
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
    -- השארית כולה נופלת על הסניף המדורג ראשון
    select branch_id,
           sum(share + case when rn = 1 and w_total > 0 then amount - share_total else 0 end) as total
    from ranked
    group by branch_id
  )
  select ab.id, coalesce(a.total, 0)
  from active_branches ab
  left join adjusted a on a.branch_id = ab.id;
$$;
