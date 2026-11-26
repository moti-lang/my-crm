-- 35_standing_link_active.sql — "קישור הרשמה חדש" (הוראת קבע) גם לפעילה שלא שילמה כלום (0058).
--   המקרה (אושרת ראובן, 15/11): נוספה ידנית כ"פעילה" במסלול "הוראת קבע 10 תשלומים", ונשלח לה קישור
--   רגיל על כל 1,800 ₪ — חיוב אחד בכרטיס, בלי בחירת תשלומים ותאריך.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

-- תלמידה שנוספה ידנית מהמסך (rpc_create_student), כבעלים.
create or replace function t_sl_add(p_first text, p_track text, p_status text default 'active') returns uuid language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  r := rpc_create_student(jsonb_build_object('branch_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'first_name', p_first, 'last_name', 'ידנית',
         'parent_phone', '05211' || lpad((abs(hashtext(p_first)) % 100000)::text, 5, '0'), 'status', p_status, 'track', p_track));
  execute 'reset role';
  return (select id from students where first_name = p_first and last_name = 'ידנית');
end $$;
create or replace function t_sl(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;
create or replace function t_sl_unpaid(p_id uuid) returns boolean language sql security definer set search_path = public, pg_temp as $$
  select f_enrollment_unpaid(s) from students s where s.id = p_id $$;
create or replace function t_sl_pay(p_id uuid, p_amount numeric) returns void language sql as $$
  insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
  select id, branch_id, current_date, p_amount, 'credit', 'manual', 'בדיקה' from students where id = p_id $$;

update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'פעילה, הוראת קבע, לא שילמה כלום (אושרת):'
begin;
create temp table t_s as select t_sl_add('אושרת', 'so10') as id;
grant select on t_s to authenticated;
select assert_true((select status = 'active' and source = 'manual' and payment_track ->> 'method' = 'standing_order' from students where id = (select id from t_s)),
                   'נוספה ידנית כפעילה, במסלול הוראת קבע 10 תשלומים');
select assert_true(t_sl_unpaid((select id from t_s)), '★ ממתינה לחיוב הראשון — גם כ"פעילה"');
select assert_true(t_sl('select rpc_create_payment_link((select id from t_s))::text') like 'ERROR: %קישור הרשמה חדש%',
                   '★ קישור רגיל על כל הסכום — נדחה, עם הפניה לקישור הרשמה חדש');
create temp table t_r as select t_sl('select rpc_renew_enrollment_link((select id from t_s))::text')::jsonb as r;
select assert_true((select (r ->> 'amount')::numeric = (select (payment_track ->> 'first_charge')::numeric from students where id = (select id from t_s)) from t_r),
                   '★ קישור הרשמה חדש: התשלום הראשון של המסלול, לא כל הסכום');
select assert_true(exists (select 1 from payment_links where student_id = (select id from t_s) and purpose = 'enrollment' and status = 'pending'),
                   'קישור מסוג הרשמה (הוראת קבע אחרי התשלום)');
select assert_true((select status = 'active' from students where id = (select id from t_s)), 'הסטטוס לא השתנה (פעילה)');
-- ההורה בוחרת יום ומשלמת את התשלום הראשון → ההוראה מוכנה ליצירה.
select rpc_standing_consent((select token from payment_links where student_id = (select id from t_s) and purpose = 'enrollment'), 12);
select rpc_record_sumit_payment((select external_identifier from payment_links where student_id = (select id from t_s) and purpose = 'enrollment'),
                                'P-SL', (select (payment_track ->> 'first_charge')::numeric from students where id = (select id from t_s)), now(), 'D-SL', 'external_identifier', '951', null);
select assert_true(exists (select 1 from jsonb_array_elements(rpc_standing_orders_to_setup()) e where e ->> 'student_id' = (select id::text from t_s)),
                   '★ אחרי התשלום הראשון — הוראת הקבע מוכנה ליצירה, ביום שנבחר');
select assert_true(not t_sl_unpaid((select id from t_s)), 'שולם — כבר לא ממתינה לחיוב הראשון');
rollback;

\echo 'מה שלא משתנה:'
begin;
create temp table t_a as select t_sl_add('שילמה', 'so10') as id;
select t_sl_pay((select id from t_a), 50);
select assert_true(not t_sl_unpaid((select id from t_a)), '★ פעילה שכבר שילמה משהו — קישור רגיל כמו קודם');
create temp table t_b as select t_sl_add('אחד', 'card1') as id;
select assert_true(not t_sl_unpaid((select id from t_b)), 'פעילה במסלול כרטיס בתשלום אחד — קישור רגיל כמו קודם (כולל סכום חלקי)');
create temp table t_c as select t_sl_add('מזומן', 'cash') as id;
select assert_true(not t_sl_unpaid((select id from t_c)), 'מזומן — לא');
create temp table t_d as select t_sl_add('חיצוני', 'so10') as id;
update students set external_payment = true where id = (select id from t_d);
select assert_true(not t_sl_unpaid((select id from t_d)), 'תשלום חיצוני — לא');
create temp table t_e as select t_sl_add('הוראה', 'so10') as id;
insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose, status)
select repeat('e', 60) || 'sl01', 'tl-sl-e', id, branch_id, 280, 'enrollment', 'cancelled' from students where id = (select id from t_e);
insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, amount, installments, installments_total, date_start,
                             consent_text, consented_at, status)
select s.id, s.branch_id, l.id, 7001, 180, 9, 10, current_date + 30, 'אישור', now(), 'cancelled'
  from students s join payment_links l on l.external_identifier = 'tl-sl-e' where s.id = (select id from t_e);
select assert_true(not t_sl_unpaid((select id from t_e)), '★ יש לה הוראת קבע (גם מבוטלת) — לא (חיוב כפול)');
create temp table t_f as select t_sl_add('ממתינה', 'so10', 'pending') as id;
select assert_true(t_sl_unpaid((select id from t_f)), 'ממתינה — כמו קודם');
create temp table t_g as select t_sl_add('הפסיקה', 'so10') as id;
update students set status = 'stopped' where id = (select id from t_g);
select assert_true(not t_sl_unpaid((select id from t_g)), 'הפסיקה — לא');
rollback;

update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function t_sl_add(text, text, text); drop function t_sl(text); drop function t_sl_unpaid(uuid); drop function t_sl_pay(uuid, numeric);
select drop_assert_helpers();
\echo '  קישור הוראת קבע לפעילה שלא שילמה: הכל עבר'
