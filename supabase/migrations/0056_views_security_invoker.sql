-- 0056 — הקשחת אבטחה: כל ה-views ב-security_invoker, בלי לשנות מי רואה מה.
--
-- הממצא (Security Advisor, security_definer_view — ERROR × 16): 16 views רצו בהרשאות הבעלים
-- (postgres) ועקפו את ה-RLS של הטבלאות. הסינון היה בתוך כל view (auth_role() / my_branches()) —
-- נבדק בענן: משתמשת מחוברת בלי תפקיד רואה 0 שורות בכל ה-18 — אבל זה דפוס שביר: view שרץ
-- כבעלים ואפשר לכתוב דרכו עקף RLS (ראו 0052).
--
-- למה לא פשוט security_invoker=true: רואת החשבון רואה דוחות כספיים (יתרות, חייבות, רווח והפסד)
-- בלי גישה לטבלת התלמידות (טלפונים, כתובות). ב-invoker ה-views האלה היו מחזירים לה כלום, או
-- שהיה צריך לפתוח לה את students כולה. שניהם גרועים.
--
-- התיקון: הגוף של כל view עובר כמו-שהוא לפונקציה SECURITY DEFINER בסכמה private (שאינה חשופה
-- ב-API — אי אפשר לקרוא לה כ-/rpc), עם search_path קבוע. ה-view עצמו הופך ל-security_invoker
-- ובוחר מהפונקציה, עם אותן עמודות ואותם טיפוסים — המסכים, ה-Edge Functions והטיפוסים לא משתנים.
-- view כזה אינו ניתן לעדכון בכלל, והסינון לפי תפקיד נשאר בדיוק מה שהיה (נבדק: אותו פלט, לכל
-- תפקיד, לפני ואחרי — supabase/tests/34_security_hardening.sql).
--
-- הגופים נוצרו אוטומטית מ-pg_get_viewdef של הסכמה אחרי 0055 (= הסכמה בענן).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ─── v_absence_streaks ───
create or replace function private.v_absence_streaks()
returns table (student_id uuid, full_name text, branch_id uuid, branch_name text, parent_name text, parent_phone text, absent_streak bigint, last_absent_on date)
language sql stable security definer set search_path = public, pg_temp as $fn$
WITH marked AS (
         SELECT a.student_id,
            l.branch_id,
            l.lesson_date,
            a.mark,
            row_number() OVER (PARTITION BY a.student_id ORDER BY l.lesson_date DESC) AS rn
           FROM attendance a
             JOIN lessons l ON l.id = a.lesson_id
          WHERE l.status = 'reported'::lesson_status
        ), streak AS (
         SELECT marked.student_id,
            marked.branch_id,
            COALESCE(min(marked.rn) FILTER (WHERE marked.mark = ANY (ARRAY['present'::attendance_mark, 'late'::attendance_mark])), count(*) + 1) - 1 AS absent_streak,
            max(marked.lesson_date) FILTER (WHERE marked.mark = 'absent'::attendance_mark) AS last_absent_on
           FROM marked
          GROUP BY marked.student_id, marked.branch_id
        )
 SELECT st.student_id,
    s.full_name,
    st.branch_id,
    b.name AS branch_name,
    s.parent_name,
    s.parent_phone,
    st.absent_streak,
    st.last_absent_on
   FROM streak st
     JOIN students s ON s.id = st.student_id
     JOIN branches b ON b.id = st.branch_id
  WHERE st.absent_streak > 0 AND s.deleted_at IS NULL AND s.status = 'active'::student_status AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (st.branch_id IN ( SELECT my_branches() AS my_branches)))
$fn$;
revoke all on function private.v_absence_streaks() from public, anon;
grant execute on function private.v_absence_streaks() to authenticated, service_role;

create or replace view public.v_absence_streaks with (security_invoker = true) as
  select student_id, full_name, branch_id, branch_name, parent_name, parent_phone, absent_streak, last_absent_on
    from private.v_absence_streaks();

-- ─── v_branch_pnl ───
create or replace function private.v_branch_pnl()
returns table (branch_id uuid, name text, income_students numeric, income_registration_fees numeric, income_other numeric, expenses numeric, open_debt numeric, active_students bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT id AS branch_id,
    name,
    ( SELECT COALESCE(sum(p.amount), 0::numeric) AS "coalesce"
           FROM payments p
             JOIN students s ON s.id = p.student_id
          WHERE p.branch_id = b.id AND p.deleted_at IS NULL) AS income_students,
    ( SELECT COALESCE(sum(LEAST(pp.paid, s.registration_fee)), 0::numeric) AS "coalesce"
           FROM students s
             JOIN ( SELECT payments.student_id,
                    sum(payments.amount) AS paid
                   FROM payments
                  WHERE payments.deleted_at IS NULL
                  GROUP BY payments.student_id) pp ON pp.student_id = s.id
          WHERE s.branch_id = b.id) AS income_registration_fees,
    ( SELECT COALESCE(sum(l.amount), 0::numeric) AS "coalesce"
           FROM ledger_entries l
          WHERE l.branch_id = b.id AND l.kind = 'income'::entry_kind AND l.scope = 'branch'::entry_scope AND l.deleted_at IS NULL) AS income_other,
    ( SELECT COALESCE(sum(l.amount), 0::numeric) AS "coalesce"
           FROM ledger_entries l
          WHERE l.branch_id = b.id AND l.kind = 'expense'::entry_kind AND l.scope = 'branch'::entry_scope AND l.deleted_at IS NULL) AS expenses,
    ( SELECT COALESCE(sum(GREATEST(vb.balance, 0::numeric)), 0::numeric) AS "coalesce"
           FROM v_student_balance vb
          WHERE vb.branch_id = b.id) AS open_debt,
    ( SELECT count(*) AS count
           FROM students s
          WHERE s.branch_id = b.id AND s.status = 'active'::student_status AND s.deleted_at IS NULL) AS active_students
   FROM branches b
  WHERE deleted_at IS NULL AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (id IN ( SELECT my_branches() AS my_branches)))
$fn$;
revoke all on function private.v_branch_pnl() from public, anon;
grant execute on function private.v_branch_pnl() to authenticated, service_role;

create or replace view public.v_branch_pnl with (security_invoker = true) as
  select branch_id, name, income_students, income_registration_fees, income_other, expenses, open_debt, active_students
    from private.v_branch_pnl();

-- ─── v_branch_profitability ───
create or replace function private.v_branch_profitability()
returns table (branch_id uuid, name text, active_students bigint, income_students numeric, income_registration_fees numeric, income_other numeric, expenses numeric, open_debt numeric, profit_before numeric, allocated numeric, profit_after numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT b.branch_id,
    b.name,
    b.active_students,
    b.income_students,
    b.income_registration_fees,
    b.income_other,
    b.expenses,
    b.open_debt,
    b.income_students + b.income_other - b.expenses AS profit_before,
    COALESCE(a.allocated_amount, 0::numeric) AS allocated,
    b.income_students + b.income_other - b.expenses - COALESCE(a.allocated_amount, 0::numeric) AS profit_after
   FROM v_branch_pnl b
     LEFT JOIN v_general_allocation a ON a.branch_id = b.branch_id
  WHERE auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])
$fn$;
revoke all on function private.v_branch_profitability() from public, anon;
grant execute on function private.v_branch_profitability() to authenticated, service_role;

create or replace view public.v_branch_profitability with (security_invoker = true) as
  select branch_id, name, active_students, income_students, income_registration_fees, income_other, expenses, open_debt, profit_before, allocated, profit_after
    from private.v_branch_profitability();

-- ─── v_debtors ───
create or replace function private.v_debtors()
returns table (student_id uuid, full_name text, branch_id uuid, branch_name text, parent_name text, parent_phone text, status student_status, due numeric, paid numeric, balance numeric, last_paid_on date, aging_from date, days_outstanding integer, aging_bucket integer)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT vb.student_id,
    vb.full_name,
    vb.branch_id,
    b.name AS branch_name,
    s.parent_name,
        CASE
            WHEN auth_role() = 'accountant'::user_role THEN NULL::text
            ELSE s.parent_phone
        END AS parent_phone,
    s.status,
    vb.due,
    vb.paid,
    vb.balance,
    vb.last_paid_on,
    COALESCE(vb.last_paid_on, s.joined_on) AS aging_from,
    CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on) AS days_outstanding,
        CASE
            WHEN (CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on)) >= 90 THEN 90
            WHEN (CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on)) >= 60 THEN 60
            WHEN (CURRENT_DATE - COALESCE(vb.last_paid_on, s.joined_on)) >= 30 THEN 30
            ELSE 0
        END AS aging_bucket
   FROM v_student_balance vb
     JOIN students s ON s.id = vb.student_id
     JOIN branches b ON b.id = vb.branch_id
  WHERE vb.balance > 0::numeric AND s.deleted_at IS NULL AND (s.status = ANY (ARRAY['active'::student_status, 'pending'::student_status]))
$fn$;
revoke all on function private.v_debtors() from public, anon;
grant execute on function private.v_debtors() to authenticated, service_role;

create or replace view public.v_debtors with (security_invoker = true) as
  select student_id, full_name, branch_id, branch_name, parent_name, parent_phone, status, due, paid, balance, last_paid_on, aging_from, days_outstanding, aging_bucket
    from private.v_debtors();

-- ─── v_enrolled_unpaid ───
create or replace function private.v_enrolled_unpaid()
returns table (student_id uuid, full_name text, parent_phone text, email text, branch_id uuid, branch_name text, enrolled_at timestamp with time zone, days_since integer, first_charge numeric, link_status text, expires_at timestamp with time zone, track_label text, track_method text, whatsapp_opt_in boolean)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT s.id AS student_id,
    s.full_name,
    s.parent_phone,
    s.email,
    s.branch_id,
    b.name AS branch_name,
    s.enrolled_at,
    CURRENT_DATE - s.enrolled_at::date AS days_since,
    l.amount AS first_charge,
    l.status AS link_status,
    l.expires_at,
    s.payment_track ->> 'label'::text AS track_label,
    s.payment_track ->> 'method'::text AS track_method,
    s.whatsapp_opt_in
   FROM students s
     JOIN branches b ON b.id = s.branch_id
     LEFT JOIN LATERAL ( SELECT payment_links.amount,
            payment_links.status,
            payment_links.expires_at
           FROM payment_links
          WHERE payment_links.student_id = s.id AND payment_links.purpose = 'enrollment'::text
          ORDER BY payment_links.created_at DESC
         LIMIT 1) l ON true
  WHERE s.deleted_at IS NULL AND s.source = 'enrollment'::text AND s.status = 'pending'::student_status AND s.cancelled_at IS NULL AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (s.branch_id IN ( SELECT my_branches() AS my_branches)))
$fn$;
revoke all on function private.v_enrolled_unpaid() from public, anon;
grant execute on function private.v_enrolled_unpaid() to authenticated, service_role;

create or replace view public.v_enrolled_unpaid with (security_invoker = true) as
  select student_id, full_name, parent_phone, email, branch_id, branch_name, enrolled_at, days_since, first_charge::numeric(10,2) as first_charge, link_status, expires_at, track_label, track_method, whatsapp_opt_in
    from private.v_enrolled_unpaid();

-- ─── v_general_allocation ───
create or replace function private.v_general_allocation()
returns table (branch_id uuid, branch_name text, allocated_amount numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT a.branch_id,
    b.name AS branch_name,
    a.allocated_amount
   FROM seasons s
     CROSS JOIN LATERAL f_general_allocation(s.id) a(branch_id, allocated_amount)
     JOIN branches b ON b.id = a.branch_id
  WHERE s.is_current AND (auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role]))
$fn$;
revoke all on function private.v_general_allocation() from public, anon;
grant execute on function private.v_general_allocation() to authenticated, service_role;

create or replace view public.v_general_allocation with (security_invoker = true) as
  select branch_id, branch_name, allocated_amount
    from private.v_general_allocation();

-- ─── v_lead_funnel ───
create or replace function private.v_lead_funnel()
returns table (month date, leads bigint, converted bigint, pending bigint, lost bigint, conversion_pct numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT date_trunc('month'::text, (created_at AT TIME ZONE 'Asia/Jerusalem'::text))::date AS month,
    count(*) AS leads,
    count(*) FILTER (WHERE status = 'active'::student_status) AS converted,
    count(*) FILTER (WHERE status = 'pending'::student_status) AS pending,
    count(*) FILTER (WHERE status = ANY (ARRAY['stopped'::student_status, 'graduated'::student_status])) AS lost,
        CASE
            WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE status = 'active'::student_status)::numeric / count(*)::numeric)
            ELSE 0::numeric
        END AS conversion_pct
   FROM students s
  WHERE source = 'whatsapp'::text AND deleted_at IS NULL AND (auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role]))
  GROUP BY (date_trunc('month'::text, (created_at AT TIME ZONE 'Asia/Jerusalem'::text))::date)
$fn$;
revoke all on function private.v_lead_funnel() from public, anon;
grant execute on function private.v_lead_funnel() to authenticated, service_role;

create or replace view public.v_lead_funnel with (security_invoker = true) as
  select month, leads, converted, pending, lost, conversion_pct
    from private.v_lead_funnel();

-- ─── v_lesson_summary ───
create or replace function private.v_lesson_summary()
returns table (lesson_id uuid, branch_id uuid, branch_name text, lesson_date date, status lesson_status, reported_at timestamp with time zone, reported_by text, attended bigint, marked bigint, expected bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT l.id AS lesson_id,
    l.branch_id,
    b.name AS branch_name,
    l.lesson_date,
    l.status,
    l.reported_at,
    l.reported_by,
    count(a.student_id) FILTER (WHERE a.mark = ANY (ARRAY['present'::attendance_mark, 'late'::attendance_mark])) AS attended,
    count(a.student_id) AS marked,
    ( SELECT count(*) AS count
           FROM students s
          WHERE s.branch_id = l.branch_id AND s.deleted_at IS NULL AND s.status = 'active'::student_status) AS expected
   FROM lessons l
     JOIN branches b ON b.id = l.branch_id
     LEFT JOIN attendance a ON a.lesson_id = l.id
  WHERE b.deleted_at IS NULL AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (l.branch_id IN ( SELECT my_branches() AS my_branches)))
  GROUP BY l.id, l.branch_id, b.name, l.lesson_date, l.status, l.reported_at, l.reported_by
$fn$;
revoke all on function private.v_lesson_summary() from public, anon;
grant execute on function private.v_lesson_summary() to authenticated, service_role;

create or replace view public.v_lesson_summary with (security_invoker = true) as
  select lesson_id, branch_id, branch_name, lesson_date, status, reported_at, reported_by, attended, marked, expected
    from private.v_lesson_summary();

-- ─── v_mailing_list ───
create or replace function private.v_mailing_list()
returns table (id uuid, full_name text, parent_name text, parent_phone text, email text, branch_name text, status student_status, enrolled_at timestamp with time zone)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT s.id,
    s.full_name,
    s.parent_name,
    s.parent_phone,
    s.email,
    b.name AS branch_name,
    s.status,
    s.enrolled_at
   FROM students s
     JOIN branches b ON b.id = s.branch_id
  WHERE s.deleted_at IS NULL AND s.mailing_consent AND auth_role() = 'owner'::user_role
$fn$;
revoke all on function private.v_mailing_list() from public, anon;
grant execute on function private.v_mailing_list() to authenticated, service_role;

create or replace view public.v_mailing_list with (security_invoker = true) as
  select id, full_name, parent_name, parent_phone, email, branch_name, status, enrolled_at
    from private.v_mailing_list();

-- ─── v_payment_reconciliation ───
create or replace function private.v_payment_reconciliation()
returns table (id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, status text, link_amount numeric, sumit_amount numeric, sumit_payment_id text, sumit_document_id text, sumit_document_url text, match_method text, paid_at timestamp with time zone, last_checked_at timestamp with time zone, recorded_amount numeric, payment_id uuid, student_name text, parent_name text, branch_name text, branch_id uuid, student_id uuid, issue text)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT l.id,
    l.created_at,
    l.expires_at,
    l.status,
    l.amount AS link_amount,
    l.sumit_amount,
    l.sumit_payment_id,
    l.sumit_document_id,
    l.sumit_document_url,
    l.match_method,
    l.paid_at,
    l.last_checked_at,
    p.amount AS recorded_amount,
    p.id AS payment_id,
    s.full_name AS student_name,
    s.parent_name,
    b.name AS branch_name,
    l.branch_id,
    l.student_id,
        CASE
            WHEN l.status = 'mismatch'::text THEN 'סכום שונה'::text
            WHEN l.status = 'paid'::text AND p.id IS NULL THEN 'שולם ב-SUMIT ולא נרשם'::text
            WHEN l.status = 'paid'::text AND p.amount <> l.sumit_amount THEN 'נרשם בסכום אחר'::text
            WHEN (l.status = ANY (ARRAY['pending'::text, 'opened'::text])) AND l.expires_at <= now() THEN 'פג ולא סומן'::text
            ELSE NULL::text
        END AS issue
   FROM payment_links l
     JOIN students s ON s.id = l.student_id
     JOIN branches b ON b.id = l.branch_id
     LEFT JOIN payments p ON p.id = l.payment_id
  WHERE (auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (l.branch_id IN ( SELECT my_branches() AS my_branches))
$fn$;
revoke all on function private.v_payment_reconciliation() from public, anon;
grant execute on function private.v_payment_reconciliation() to authenticated, service_role;

create or replace view public.v_payment_reconciliation with (security_invoker = true) as
  select id, created_at, expires_at, status, link_amount::numeric(10,2) as link_amount, sumit_amount::numeric(10,2) as sumit_amount, sumit_payment_id, sumit_document_id, sumit_document_url, match_method, paid_at, last_checked_at, recorded_amount::numeric(10,2) as recorded_amount, payment_id, student_name, parent_name, branch_name, branch_id, student_id, issue
    from private.v_payment_reconciliation();

-- ─── v_pnl_monthly ───
create or replace function private.v_pnl_monthly()
returns table (season_id uuid, month date, income_students numeric, income_other numeric, expenses numeric, expenses_branch numeric, expenses_general numeric, expenses_production numeric, profit numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
WITH months AS (
         SELECT s.season_id,
            date_trunc('month'::text, p.paid_on::timestamp with time zone)::date AS month,
            sum(p.amount) AS income_students,
            0::numeric AS income_other,
            0::numeric AS expenses,
            0::numeric AS expenses_branch,
            0::numeric AS expenses_general,
            0::numeric AS expenses_production
           FROM payments p
             JOIN students s ON s.id = p.student_id
          WHERE p.deleted_at IS NULL
          GROUP BY s.season_id, (date_trunc('month'::text, p.paid_on::timestamp with time zone))
        UNION ALL
         SELECT l.season_id,
            date_trunc('month'::text, l.entry_date::timestamp with time zone)::date AS date_trunc,
            0,
            sum(l.amount) FILTER (WHERE l.kind = 'income'::entry_kind) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind AND l.scope = 'branch'::entry_scope) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind AND l.scope = 'general'::entry_scope) AS sum,
            sum(l.amount) FILTER (WHERE l.kind = 'expense'::entry_kind AND l.scope = 'production'::entry_scope) AS sum
           FROM ledger_entries l
          WHERE l.deleted_at IS NULL
          GROUP BY l.season_id, (date_trunc('month'::text, l.entry_date::timestamp with time zone))
        )
 SELECT season_id,
    month,
    COALESCE(sum(income_students), 0::numeric) AS income_students,
    COALESCE(sum(income_other), 0::numeric) AS income_other,
    COALESCE(sum(expenses), 0::numeric) AS expenses,
    COALESCE(sum(expenses_branch), 0::numeric) AS expenses_branch,
    COALESCE(sum(expenses_general), 0::numeric) AS expenses_general,
    COALESCE(sum(expenses_production), 0::numeric) AS expenses_production,
    COALESCE(sum(income_students), 0::numeric) + COALESCE(sum(income_other), 0::numeric) - COALESCE(sum(expenses), 0::numeric) AS profit
   FROM months
  WHERE auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])
  GROUP BY season_id, month
$fn$;
revoke all on function private.v_pnl_monthly() from public, anon;
grant execute on function private.v_pnl_monthly() to authenticated, service_role;

create or replace view public.v_pnl_monthly with (security_invoker = true) as
  select season_id, month, income_students, income_other, expenses, expenses_branch, expenses_general, expenses_production, profit
    from private.v_pnl_monthly();

-- ─── v_production_pnl ───
create or replace function private.v_production_pnl()
returns table (production_id uuid, name text, year text, status production_status, budget numeric, release_date date, notes text, expenses numeric, income numeric, profit numeric, budget_used_pct numeric, cast_count bigint, created_at timestamp with time zone)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT p.id AS production_id,
    p.name,
    p.year,
    p.status,
    p.budget,
    p.release_date,
    p.notes,
    COALESCE(x.expenses, 0::numeric) AS expenses,
    COALESCE(x.income, 0::numeric) AS income,
    COALESCE(x.income, 0::numeric) - COALESCE(x.expenses, 0::numeric) AS profit,
        CASE
            WHEN COALESCE(p.budget, 0::numeric) > 0::numeric THEN round(100.0 * COALESCE(x.expenses, 0::numeric) / p.budget)
            ELSE NULL::numeric
        END AS budget_used_pct,
    COALESCE(c.cast_count, 0::bigint) AS cast_count,
    p.created_at
   FROM productions p
     LEFT JOIN ( SELECT ledger_entries.production_id,
            sum(ledger_entries.amount) FILTER (WHERE ledger_entries.kind = 'expense'::entry_kind) AS expenses,
            sum(ledger_entries.amount) FILTER (WHERE ledger_entries.kind = 'income'::entry_kind) AS income
           FROM ledger_entries
          WHERE ledger_entries.scope = 'production'::entry_scope AND ledger_entries.deleted_at IS NULL
          GROUP BY ledger_entries.production_id) x ON x.production_id = p.id
     LEFT JOIN ( SELECT production_cast.production_id,
            count(*) AS cast_count
           FROM production_cast
          GROUP BY production_cast.production_id) c ON c.production_id = p.id
  WHERE p.deleted_at IS NULL AND (auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role]))
$fn$;
revoke all on function private.v_production_pnl() from public, anon;
grant execute on function private.v_production_pnl() to authenticated, service_role;

create or replace view public.v_production_pnl with (security_invoker = true) as
  select production_id, name, year, status, budget::numeric(10,2) as budget, release_date, notes, expenses, income, profit, budget_used_pct, cast_count, created_at
    from private.v_production_pnl();

-- ─── v_standing_order_events ───
create or replace function private.v_standing_order_events()
returns table (id uuid, standing_order_id uuid, student_id uuid, full_name text, branch_id uuid, branch_name text, kind text, from_date date, to_date date, from_day integer, to_day integer, remaining integer, actor_label text, created_at timestamp with time zone, from_amount numeric, to_amount numeric, note text)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT e.id,
    e.standing_order_id,
    o.student_id,
    s.full_name,
    o.branch_id,
    b.name AS branch_name,
    e.kind,
    e.from_date,
    e.to_date,
    e.from_day,
    e.to_day,
    e.remaining,
    e.actor_label,
    e.created_at,
    e.from_amount,
    e.to_amount,
    e.note
   FROM standing_order_events e
     JOIN standing_orders o ON o.id = e.standing_order_id
     JOIN students s ON s.id = o.student_id
     JOIN branches b ON b.id = o.branch_id
  WHERE (auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (o.branch_id IN ( SELECT my_branches() AS my_branches))
$fn$;
revoke all on function private.v_standing_order_events() from public, anon;
grant execute on function private.v_standing_order_events() to authenticated, service_role;

create or replace view public.v_standing_order_events with (security_invoker = true) as
  select id, standing_order_id, student_id, full_name, branch_id, branch_name, kind, from_date, to_date, from_day, to_day, remaining, actor_label, created_at, from_amount::numeric(10,2) as from_amount, to_amount::numeric(10,2) as to_amount, note
    from private.v_standing_order_events();

-- ─── v_standing_orders ───
create or replace function private.v_standing_orders()
returns table (id uuid, student_id uuid, full_name text, branch_id uuid, branch_name text, status text, sumit_status integer, amount numeric, installments_total integer, charged_total integer, failed_count integer, date_start date, next_billing date, last_billing date, last_error text, last_checked_at timestamp with time zone, cancelled_at timestamp with time zone, created_at timestamp with time zone, needs_attention boolean, billing_day integer, remaining integer)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT o.id,
    o.student_id,
    s.full_name,
    o.branch_id,
    b.name AS branch_name,
    o.status,
    o.sumit_status,
    o.amount,
    o.installments_total,
    o.charged_count + 1 AS charged_total,
    o.failed_count,
    o.date_start,
    o.next_billing,
    o.last_billing,
    o.last_error,
    o.last_checked_at,
    o.cancelled_at,
    o.created_at,
    o.status = ANY (ARRAY['failed'::text, 'retrying'::text, 'setup_failed'::text]) AS needs_attention,
    o.billing_day,
    o.installments - o.charged_count AS remaining
   FROM standing_orders o
     JOIN students s ON s.id = o.student_id
     JOIN branches b ON b.id = o.branch_id
  WHERE (auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (o.branch_id IN ( SELECT my_branches() AS my_branches))
$fn$;
revoke all on function private.v_standing_orders() from public, anon;
grant execute on function private.v_standing_orders() to authenticated, service_role;

create or replace view public.v_standing_orders with (security_invoker = true) as
  select id, student_id, full_name, branch_id, branch_name, status, sumit_status, amount::numeric(10,2) as amount, installments_total, charged_total, failed_count, date_start, next_billing, last_billing, last_error, last_checked_at, cancelled_at, created_at, needs_attention, billing_day, remaining
    from private.v_standing_orders();

-- ─── v_student_balance ───
create or replace function private.v_student_balance()
returns table (student_id uuid, branch_id uuid, season_id uuid, full_name text, due numeric, paid numeric, balance numeric, last_paid_on date, registration_fee numeric, registration_paid numeric, tuition_paid numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT s.id AS student_id,
    s.branch_id,
    s.season_id,
    s.full_name,
    s.tuition_total - s.discount + s.registration_fee AS due,
    COALESCE(p.paid, 0::numeric) AS paid,
    s.tuition_total - s.discount + s.registration_fee - COALESCE(p.paid, 0::numeric) AS balance,
    p.last_paid_on,
    s.registration_fee,
    LEAST(COALESCE(p.paid, 0::numeric), s.registration_fee) AS registration_paid,
    GREATEST(COALESCE(p.paid, 0::numeric) - s.registration_fee, 0::numeric) AS tuition_paid
   FROM students s
     LEFT JOIN ( SELECT payments.student_id,
            sum(payments.amount) AS paid,
            max(payments.paid_on) AS last_paid_on
           FROM payments
          WHERE payments.deleted_at IS NULL
          GROUP BY payments.student_id) p ON p.student_id = s.id
  WHERE s.deleted_at IS NULL AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR auth_role() = 'branch_manager'::user_role AND (s.branch_id IN ( SELECT my_branches() AS my_branches)))
$fn$;
revoke all on function private.v_student_balance() from public, anon;
grant execute on function private.v_student_balance() to authenticated, service_role;

create or replace view public.v_student_balance with (security_invoker = true) as
  select student_id, branch_id, season_id, full_name, due, paid, balance, last_paid_on, registration_fee::numeric(10,2) as registration_fee, registration_paid, tuition_paid
    from private.v_student_balance();

-- ─── v_students_accounting ───
create or replace function private.v_students_accounting()
returns table (id uuid, season_id uuid, branch_id uuid, full_name text, grade text, group_name text, status student_status, joined_on date, stopped_on date, tuition_total numeric, discount numeric, installments integer, registration_fee numeric, installments_total integer, school text, enrolled_at timestamp with time zone, cancelled_at timestamp with time zone, refund_amount numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
SELECT id,
    season_id,
    branch_id,
    full_name,
    grade,
    group_name,
    status,
    joined_on,
    stopped_on,
    tuition_total,
    discount,
    installments,
    registration_fee,
    installments_total,
    school,
    enrolled_at,
    cancelled_at,
    refund_amount
   FROM students s
  WHERE deleted_at IS NULL AND auth_role() = 'accountant'::user_role
$fn$;
revoke all on function private.v_students_accounting() from public, anon;
grant execute on function private.v_students_accounting() to authenticated, service_role;

create or replace view public.v_students_accounting with (security_invoker = true) as
  select id, season_id, branch_id, full_name, grade, group_name, status, joined_on, stopped_on, tuition_total::numeric(10,2) as tuition_total, discount::numeric(10,2) as discount, installments, registration_fee::numeric(10,2) as registration_fee, installments_total, school, enrolled_at, cancelled_at, refund_amount::numeric(10,2) as refund_amount
    from private.v_students_accounting();

-- f_general_allocation נקראת עכשיו רק מתוך private.v_general_allocation (כבעלים). קריאה ישירה
-- (POST /rpc/f_general_allocation) החזירה לכל משתמשת מחוברת — גם מנהלת סניף או מושבתת — את
-- חלוקת ההוצאות הכלליות לכל הסניפים.
revoke all on function f_general_allocation(uuid) from public, anon, authenticated;

do $$
declare v_left text;
begin
  select string_agg(c.relname, ', ') into v_left
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce(c.reloptions, '{}') @> '{security_invoker=true}';
  if v_left is not null then raise exception 'views בלי security_invoker: %', v_left; end if;
end $$;
