-- 0002_rls.sql — הרשאות. מקור האמת היחיד לגישה לנתונים הוא כאן, לא בצד הלקוח.

-- ─────────────────────────── פונקציות עזר ────────────────────────────
-- security definer: אחרת auth_role() קורא ל-profiles שעליה יש RLS שקוראת
-- ל-auth_role() — רקורסיה אינסופית. search_path נעול מפני חטיפה.
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function my_branches() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select branch_id from branch_staff where user_id = auth.uid()
$$;

revoke all on function auth_role()   from public;
revoke all on function my_branches() from public;
grant execute on function auth_role(), my_branches() to authenticated;

-- ───────────────────── הרשאות בסיס: anon לא נוגע בכלום ────────────────
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on public.%I from anon', t.tablename);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t.tablename);
  end loop;
end $$;

-- ─────────────────────────────── profiles ────────────────────────────
create policy profiles_self  on profiles for select using (id = auth.uid());
create policy profiles_owner on profiles for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');

-- ──────────────────────────────── seasons ────────────────────────────
create policy seasons_read  on seasons for select using (auth_role() is not null);
create policy seasons_owner on seasons for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');

-- ─────────────────────────────── branches ────────────────────────────
create policy branches_owner on branches for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy branches_manager on branches for select
  using (auth_role() = 'branch_manager' and id in (select my_branches()));
create policy branches_accountant on branches for select
  using (auth_role() = 'accountant');

-- ────────────────────────────── branch_staff ─────────────────────────
create policy branch_staff_owner on branch_staff for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy branch_staff_self on branch_staff for select using (user_id = auth.uid());

-- ─────────────────────────────── students ────────────────────────────
-- רואת חשבון אינה מקבלת גישה ישירה לטבלה (יש בה טלפונים וכתובות);
-- היא קוראת דרך v_students_accounting בלבד. ראה סוף הקובץ.
create policy students_owner on students for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy students_manager on students for all
  using (auth_role() = 'branch_manager' and branch_id in (select my_branches()))
  with check (auth_role() = 'branch_manager' and branch_id in (select my_branches()));

-- ─────────────────────────────── payments ────────────────────────────
create policy payments_owner on payments for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy payments_manager_read on payments for select
  using (auth_role() = 'branch_manager' and student_id in (
    select s.id from students s where s.branch_id in (select my_branches())));
create policy payments_manager_insert on payments for insert
  with check (auth_role() = 'branch_manager' and student_id in (
    select s.id from students s where s.branch_id in (select my_branches())));
create policy payments_accountant on payments for select using (auth_role() = 'accountant');

-- ───────────────────────────── ledger_entries ────────────────────────
create policy ledger_owner on ledger_entries for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy ledger_manager on ledger_entries for all
  using (auth_role() = 'branch_manager' and scope='branch' and branch_id in (select my_branches()))
  with check (auth_role() = 'branch_manager' and scope='branch' and branch_id in (select my_branches()));
create policy ledger_accountant on ledger_entries for select using (auth_role() = 'accountant');

-- ───────────────────────── productions / cast ────────────────────────
create policy productions_owner on productions for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy productions_read on productions for select
  using (auth_role() in ('branch_manager','accountant'));
create policy cast_owner on production_cast for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy cast_read on production_cast for select
  using (auth_role() in ('branch_manager','accountant'));

-- ──────────────────────── lessons / attendance ───────────────────────
create policy lessons_owner on lessons for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy lessons_manager on lessons for all
  using (auth_role() = 'branch_manager' and branch_id in (select my_branches()))
  with check (auth_role() = 'branch_manager' and branch_id in (select my_branches()));

create policy attendance_owner on attendance for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy attendance_manager on attendance for all
  using (auth_role() = 'branch_manager' and lesson_id in (
    select l.id from lessons l where l.branch_id in (select my_branches())))
  with check (auth_role() = 'branch_manager' and lesson_id in (
    select l.id from lessons l where l.branch_id in (select my_branches())));

create policy links_owner on attendance_links for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy links_manager on attendance_links for select
  using (auth_role() = 'branch_manager' and branch_id in (select my_branches()));

-- ───────────────────── תזכורות, הודעות, תבניות ───────────────────────
create policy reminders_owner on reminders for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy reminders_manager on reminders for select using (auth_role() = 'branch_manager');
create policy wa_owner on wa_messages for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy wa_manager on wa_messages for select using (auth_role() = 'branch_manager');
create policy templates_owner on message_templates for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy templates_read on message_templates for select using (auth_role() is not null);

-- ───────────────────── קטגוריות, חגים (קריאה לכולם) ──────────────────
create policy categories_owner on categories for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy categories_read on categories for select using (auth_role() is not null);
create policy holidays_owner on holidays for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy holidays_read on holidays for select using (auth_role() is not null);

-- ──────────────── סוכן הלקוחות ופקודות — בעלים בלבד ──────────────────
create policy faq_owner on faq_entries for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy conv_owner on conversations for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy unanswered_owner on unanswered_questions for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy authnum_owner on authorized_numbers for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy commands_owner on commands for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy settings_owner on settings for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');

-- audit_log: הבעלים קוראת בלבד. הכתיבה היא של service_role (Edge Functions).
create policy audit_owner_read on audit_log for select using (auth_role() = 'owner');
revoke insert, update, delete on audit_log from authenticated;

-- ───────────────── תצוגת רואת חשבון: ללא טלפון וכתובת ────────────────
-- security_invoker=false (ברירת המחדל): התצוגה רצה בהרשאות הבעלים שלה
-- ולכן עוקפת את RLS של students; הסינון הפנימי הוא מה שמגביל לרואת חשבון.
create view v_students_accounting as
select s.id, s.season_id, s.branch_id, s.full_name, s.grade, s.group_name,
       s.status, s.joined_on, s.stopped_on, s.tuition_total, s.discount, s.installments
from students s
where s.deleted_at is null and auth_role() = 'accountant';

revoke all on v_students_accounting from anon;
grant select on v_students_accounting to authenticated;

-- ה-views הרגילות: security_invoker=true כדי שירשו את RLS של הטבלאות שמתחת.
alter view v_student_balance set (security_invoker = true);
alter view v_branch_pnl      set (security_invoker = true);
revoke all on v_student_balance, v_branch_pnl from anon;
grant select on v_student_balance, v_branch_pnl to authenticated;
