-- 41_tuition_change.sql — שינוי מחיר ידני (0064).
--   המקרה (23/11): תלמידה הועברה בין סניפים, המחיר בסניף החדש 3,000 במקום 1,200. שולמו 540 (320 + 220),
--   ובהוראת הקבע נשארו 3 × 220.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_tc(p_sql text, p_role user_role default 'owner') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;
create or replace function t_tc_student(p_paid boolean) returns uuid language plpgsql as $$
declare v uuid := 'dddddddd-0000-0000-0000-000000000410';
begin
  insert into students (id, season_id, branch_id, full_name, status, tuition_total, registration_fee, discount, parent_phone, payment_track)
  select v, season_id, 'bbbbbbbb-0000-0000-0000-000000000001', 'בדיקת מחיר', case when p_paid then 'active' else 'pending' end::student_status,
         1100, 100, 0, '972521009999',
         '{"key": "so5", "total": 1200, "method": "standing_order", "first_charge": 320, "installments": 5, "first_installment": 220, "installment_amount": 220}'::jsonb
    from students where id = 'dddddddd-0000-0000-0000-000000000001';
  if p_paid then
    insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, status, paid_at)
    values ('eeeeeeee-0000-0000-0000-000000000411', repeat('6', 60) || '0411', 'tc-1', v, 'bbbbbbbb-0000-0000-0000-000000000001', 320, 'enrollment', 'paid', now() - interval '40 days');
    insert into payments (student_id, branch_id, paid_on, amount, method, source) values
      (v, 'bbbbbbbb-0000-0000-0000-000000000001', current_date - 40, 320, 'credit', 'sumit'),
      (v, 'bbbbbbbb-0000-0000-0000-000000000001', current_date - 9, 220, 'credit', 'sumit');
    insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                                 installments_total, date_start, consent_text, consented_at, status, next_billing, charged_count)
    values ('eeeeeeee-0000-0000-0000-000000000412', v, 'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000411',
            1, 2, 220, 4, 5, current_date - 9, 'אישור', now() - interval '40 days', 'active', current_date + 21, 1);
  end if;
  return v;
end $$;
create or replace function t_tc_go(p_total numeric, p_reason text, p_expected numeric, p_role user_role default 'owner') returns text language sql as $$
  select t_tc(format('select rpc_change_tuition(%L, %s, %L, %s)::text', 'dddddddd-0000-0000-0000-000000000410', p_total, p_reason, p_expected), p_role)
$$;
create or replace function t_tc_plan(p_total numeric, p_role user_role default 'owner') returns jsonb language sql as $$
  select t_tc(format('select rpc_tuition_preview(%L, %s)::text', 'dddddddd-0000-0000-0000-000000000410', p_total), p_role)::jsonb
$$;

\echo 'הוראת קבע פעילה — המחיר עולה, ההוראה ממשיכה כמו שאושרה:'
begin;
select t_tc_student(true);
select assert_true((select (p ->> 'ok')::boolean and (p ->> 'balance_before')::numeric = 660 and (p ->> 'balance_after')::numeric = 2460
                           and p ->> 'lines' like '%3,000 ₪ במקום 1,200 ₪%' and p ->> 'lines' like '%3 × 220 ₪%' and p ->> 'lines' like '%ההפרש — 1,800 ₪%'
                      from (select t_tc_plan(3000) p) x),
                   '★ התוכנית: 3,000 במקום 1,200; נשאר 2,460; ההוראה 3 × 220; ההפרש 1,800 — חוב');
select assert_true(t_tc_plan(3000, 'branch_manager') ->> 'error' like 'רק הבעלים%', '★ מנהלת סניף — אין תוכנית');
select assert_true(t_tc_go(3000, 'x', 2460, 'branch_manager') like 'ERROR: רק הבעלים%', '★ מנהלת סניף — לא');
select assert_true(t_tc_go(3000, ' ', 2460) like 'ERROR: יש לכתוב למה%', 'בלי סיבה — לא');
select assert_true(t_tc_go(3000, 'x', 2000) like 'ERROR: המצב השתנה%', '★ היתרה שונה ממה שהבעלים ראתה — לא נשמר');
select assert_true((t_tc_go(3000, 'נרשמה בטעות בסניף אחר', 2460)::jsonb ->> 'ok')::boolean, 'נשמר');
select assert_true((select tuition_total = 2900 and registration_fee = 100 and discount = 0 and payment_track ->> 'installment_amount' = '220'
                      from students where id = 'dddddddd-0000-0000-0000-000000000410'), '★ שכר הלימוד 2,900 (+100 רישום); המסלול שאושר — לא נגעו');
select assert_true((select amount = 220 and installments = 4 and charged_count = 1 and status = 'active'
                      from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000412'), '★ הוראת הקבע — בלי שום שינוי (ההורה אישרה 220)');
select assert_true((select balance = 2460 from v_student_balance where student_id = 'dddddddd-0000-0000-0000-000000000410'), '★ בגבייה: חוב של 2,460');
select assert_true((select count(*) = 1 from t_tc(format('select string_agg(from_total || ''>'' || to_total || ''|'' || reason || ''|'' || changed_by, '','') from rpc_student_tuition_history(%L)',
                                                      'dddddddd-0000-0000-0000-000000000410')) x(v)
                      where v = '1200.00>3000.00|נרשמה בטעות בסניף אחר|' || (select full_name from profiles where id = t_user('owner'::user_role))),
                   '★ בהיסטוריה: מכמה לכמה, למה, ומי');
select assert_true(current_setting('app.tuition_reason', true) = '', 'הסיבה לא נשארת לעדכון הבא');
-- ★ הורדה מתחת למה שההוראה עוד תגבה — לא (היא הייתה גובה יותר מהמחיר): דרך הנחה.
select assert_true(t_tc_plan(1000) ->> 'error' like 'בהוראת הקבע נשארו עוד 660 ₪%הנחה%', '★ מחיר נמוך ממה שההוראה עוד תגבה — לא, להשתמש בהנחה');
rollback;

\echo 'עוד לא שולם כלום — המסלול והקישור מתעדכנים:'
begin;
select t_tc_student(false);
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, status)
values ('eeeeeeee-0000-0000-0000-000000000413', repeat('6', 60) || '0413', 'tc-2', 'dddddddd-0000-0000-0000-000000000410', 'bbbbbbbb-0000-0000-0000-000000000001', 320, 'enrollment', 'pending');
insert into reminders (id, kind, student_id, branch_id, to_phone, body, scheduled_at, dedupe_key)
values ('eeeeeeee-0000-0000-0000-000000000414', 'payment_link', 'dddddddd-0000-0000-0000-000000000410', 'bbbbbbbb-0000-0000-0000-000000000001', '972521009999', 'קישור', now() + interval '1 hour', 'tc-link');
select assert_true((select p ->> 'lines' like '%תשלום ראשון של 680 ₪, ואחריו 4 × 580 ₪%' and p ->> 'lines' like '%הקישור הפתוח%יבוטל%' from (select t_tc_plan(3000) p) x),
                   '★ התוכנית: המסלול מחושב מחדש (680, ואחריו 4 × 580), והקישור הישן יבוטל');
select t_tc_go(3000, 'מחיר הסניף', 3000);
select assert_true((select (payment_track ->> 'first_charge')::numeric = 680 and (payment_track ->> 'installment_amount')::numeric = 580
                           and (payment_track ->> 'total')::numeric = 3000 from students where id = 'dddddddd-0000-0000-0000-000000000410'),
                   '★ המסלול עודכן — "קישור הרשמה חדש" ייבנה מהמחיר החדש');
select assert_true((select status = 'cancelled' from payment_links where id = 'eeeeeeee-0000-0000-0000-000000000413'), '★ הקישור בסכום הישן — בוטל');
select assert_true((select status = 'cancelled' from reminders where id = 'eeeeeeee-0000-0000-0000-000000000414'), '...וההודעה שלו לא יוצאת');
rollback;

\echo 'מתי אי אפשר:'
begin;
select t_tc_student(false);
select assert_true(t_tc_plan(1200) ->> 'error' = 'זה כבר המחיר של התלמידה', 'אותו מחיר — לא');
select assert_true(f_tuition_plan('dddddddd-0000-0000-0000-000000000410', 1200) ->> 'error' = 'זה כבר המחיר של התלמידה', 'התוכנית עצמה — אותה תשובה');
select assert_true(t_tc_plan(50) ->> 'error' like 'הסכום השנתי כולל את דמי הרישום%', 'נמוך מדמי הרישום — לא');
select assert_true(t_tc_plan(1200.5) ->> 'error' like 'הסכום השנתי: בשקלים שלמים%', 'לא שקלים שלמים — לא');
update students set discount = 500 where id = 'dddddddd-0000-0000-0000-000000000410';
select assert_true(t_tc_plan(400) ->> 'error' like 'לתלמידה יש הנחה של 500%', 'הנחה גדולה מהמחיר החדש — לא');
rollback;
begin;
select t_tc_student(false);
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose, status, paid_at)
values ('eeeeeeee-0000-0000-0000-000000000415', repeat('6', 60) || '0415', 'tc-3', 'dddddddd-0000-0000-0000-000000000410', 'bbbbbbbb-0000-0000-0000-000000000001', 320, 'enrollment', 'paid', now());
select assert_true(t_tc_plan(3000) ->> 'error' like 'החיוב הראשון שולם והוראת הקבע עוד נוצרת%', '★ שולם והוראת הקבע עוד לא נוצרה — לחכות');
rollback;

\echo 'יומן — גם בעדכון ישיר:'
begin;
update students set tuition_total = tuition_total + 1 where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true((select count(*) = 1 from audit_log where action = 'tuition_change' and row_id = 'dddddddd-0000-0000-0000-000000000001'), '★ כל שינוי מחיר נרשם ביומן');
rollback;

select assert_no_execute('anon', 'rpc_change_tuition(uuid, numeric, text, numeric)');
select assert_no_execute('anon', 'rpc_tuition_preview(uuid, numeric)');
select assert_no_execute('anon', 'rpc_student_tuition_history(uuid)');
select assert_no_execute('authenticated', 'f_tuition_plan(uuid, numeric)');
select assert_no_execute('authenticated', 'f_student_tuition_audit()');
drop function t_tc_go(numeric, text, numeric, user_role); drop function t_tc_plan(numeric, user_role); drop function t_tc_student(boolean); drop function t_tc(text, user_role);
select drop_assert_helpers();
\echo '  שינוי מחיר ידני: הכל עבר'
