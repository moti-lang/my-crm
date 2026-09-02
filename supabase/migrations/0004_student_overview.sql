-- 0004 — תצוגת תלמידות למסך הרשימה ולכרטיס.
-- מאחדת פרטים, יתרה ואחוז נוכחות, כדי שהמסך לא יבנה שלוש שאילתות ויחבר בזיכרון.
--
-- security_invoker = true: התצוגה יורשת את RLS של students. מנהלת סניף
-- רואה כאן בדיוק את מה שהיא רואה בטבלה — לא יותר. יש בדיקה על זה.
create view v_student_overview as
select
  s.id,
  s.season_id,
  s.branch_id,
  b.name as branch_name,
  s.full_name,
  s.grade,
  s.group_name,
  s.parent_name,
  s.parent_phone,
  s.status,
  s.joined_on,
  s.stopped_on,
  s.stop_reason,
  s.tuition_total,
  s.discount,
  s.discount_reason,
  s.installments,
  s.photo_consent,
  s.notes,
  (s.tuition_total - s.discount)                                as due,
  coalesce(p.paid, 0)                                           as paid,
  (s.tuition_total - s.discount) - coalesce(p.paid, 0)          as balance,
  p.last_paid_on,
  coalesce(a.attended, 0)                                       as lessons_attended,
  coalesce(a.total, 0)                                          as lessons_total,
  case when coalesce(a.total, 0) > 0
       then round(100.0 * a.attended / a.total)
       else null end                                            as attendance_pct
from students s
join branches b on b.id = s.branch_id
left join (
  select student_id, sum(amount) as paid, max(paid_on) as last_paid_on
  from payments where deleted_at is null group by student_id
) p on p.student_id = s.id
left join (
  select student_id,
         count(*) filter (where mark in ('present','late')) as attended,
         count(*)                                           as total
  from attendance group by student_id
) a on a.student_id = s.id
where s.deleted_at is null;

alter view v_student_overview set (security_invoker = true);
revoke all on v_student_overview from anon;
grant select on v_student_overview to authenticated;
