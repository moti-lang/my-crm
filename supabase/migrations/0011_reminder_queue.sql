-- 0011 — תור התזכורות.
--
-- הבעיה שנפתרת כאן: cron-debt רץ כל יום. בלי מפתח ייחודיות, תלמידה
-- עם חוב תקבל את אותה תזכורת כל בוקר מחדש. האפיון אומר "פעם אחת לכל
-- סף" (30/60/90), וזו האכיפה שלו — במסד, לא בקוד.
--
-- מבנה המפתח: debt:{student}:{threshold}:{last_paid_on}
-- כשההורה משלמת, last_paid_on משתנה, המפתח משתנה, והמונה מתאפס.
-- כלומר מחזור חוב חדש יקבל תזכורות חדשות, וחוב ישן לא יוצף.
alter table reminders add column dedupe_key text;

create unique index reminders_dedupe_idx on reminders (dedupe_key)
  where dedupe_key is not null;

-- שליפת התור: מה שהגיע זמנו ועדיין ממתין.
create index reminders_due_status_idx on reminders (scheduled_at)
  where status = 'scheduled';

-- ─────────── תלמידות עם היעדרויות רצופות ───────────
-- לחישוב התראת הנשירה. הרצף נמדד מהשיעורים האחרונים אחורה.
create view v_absence_streaks as
with marked as (
  select a.student_id, l.branch_id, l.lesson_date, a.mark,
         row_number() over (partition by a.student_id order by l.lesson_date desc) as rn
  from attendance a
  join lessons l on l.id = a.lesson_id
  where l.status = 'reported'
),
streak as (
  select student_id, branch_id,
         -- אורך רצף ההיעדרויות מהשיעור האחרון אחורה
         coalesce(min(rn) filter (where mark in ('present','late')), count(*) + 1) - 1 as absent_streak,
         max(lesson_date) filter (where mark = 'absent') as last_absent_on
  from marked
  group by student_id, branch_id
)
select st.student_id, s.full_name, st.branch_id, b.name as branch_name,
       s.parent_name, s.parent_phone, st.absent_streak, st.last_absent_on
from streak st
join students s on s.id = st.student_id
join branches b on b.id = st.branch_id
where st.absent_streak > 0
  and s.deleted_at is null
  and s.status = 'active'
  and (
    auth_role() in ('owner', 'accountant')
    or (auth_role() = 'branch_manager' and st.branch_id in (select my_branches()))
  );

alter view v_absence_streaks set (security_invoker = false);
revoke all on v_absence_streaks from anon;
grant select on v_absence_streaks to authenticated;

-- ─────────── אוטומציות ניתנות לכיבוי ───────────
insert into settings (key, value) values
  ('automations', '{"debt_reminders":true,"attendance_nudge":true,"absence_alerts":true,"daily_summary":true,"weekly_summary":true}')
on conflict (key) do nothing;
