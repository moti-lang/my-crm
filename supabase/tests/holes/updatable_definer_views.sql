-- חור מכוון: שני ה-views כפי שהיו לפני 0052/0056 — רצים כבעלים, ניתנים לעדכון, עם ALL ל-authenticated.
-- (כך הם היו בענן עד 11/2026.) לבקרת השלילה בלבד.
create or replace view v_students_accounting with (security_invoker = false) as
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
  WHERE ((deleted_at IS NULL) AND (auth_role() = 'accountant'::user_role));
create or replace view v_branch_pnl with (security_invoker = false) as
SELECT id AS branch_id,
    name,
    ( SELECT COALESCE(sum(p.amount), (0)::numeric) AS "coalesce"
           FROM (payments p
             JOIN students s ON ((s.id = p.student_id)))
          WHERE ((p.branch_id = b.id) AND (p.deleted_at IS NULL))) AS income_students,
    ( SELECT COALESCE(sum(LEAST(pp.paid, s.registration_fee)), (0)::numeric) AS "coalesce"
           FROM (students s
             JOIN ( SELECT payments.student_id,
                    sum(payments.amount) AS paid
                   FROM payments
                  WHERE (payments.deleted_at IS NULL)
                  GROUP BY payments.student_id) pp ON ((pp.student_id = s.id)))
          WHERE (s.branch_id = b.id)) AS income_registration_fees,
    ( SELECT COALESCE(sum(l.amount), (0)::numeric) AS "coalesce"
           FROM ledger_entries l
          WHERE ((l.branch_id = b.id) AND (l.kind = 'income'::entry_kind) AND (l.scope = 'branch'::entry_scope) AND (l.deleted_at IS NULL))) AS income_other,
    ( SELECT COALESCE(sum(l.amount), (0)::numeric) AS "coalesce"
           FROM ledger_entries l
          WHERE ((l.branch_id = b.id) AND (l.kind = 'expense'::entry_kind) AND (l.scope = 'branch'::entry_scope) AND (l.deleted_at IS NULL))) AS expenses,
    ( SELECT COALESCE(sum(GREATEST(vb.balance, (0)::numeric)), (0)::numeric) AS "coalesce"
           FROM v_student_balance vb
          WHERE (vb.branch_id = b.id)) AS open_debt,
    ( SELECT count(*) AS count
           FROM students s
          WHERE ((s.branch_id = b.id) AND (s.status = 'active'::student_status) AND (s.deleted_at IS NULL))) AS active_students
   FROM branches b
  WHERE ((deleted_at IS NULL) AND ((auth_role() = ANY (ARRAY['owner'::user_role, 'accountant'::user_role])) OR ((auth_role() = 'branch_manager'::user_role) AND (id IN ( SELECT my_branches() AS my_branches)))));
grant all on v_students_accounting, v_branch_pnl to authenticated;
