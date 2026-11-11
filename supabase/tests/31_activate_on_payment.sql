-- 31_activate_on_payment.sql — "ממתינה" → "פעילה" ברגע שהחיוב הראשון שולם, בכל דרך (0049).
--   המקרה (11/11): אדל לוגסי (רישום ידני) וחנה הן (קישור תשלום רגיל) שילמו 2,100 ₪ ונשארו
--   "ממתינה" — ולחנה הן נשלח "קישור הרשמה חדש" אחרי שכבר שילמה הכל.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

create or replace function t_ap_enroll(p_first text, p_track text default 'so10') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'הפעלה', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', '0521117' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'ap@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', p_track, 'whatsapp', 'yes', 'photo', 'yes', 'billing_day', '20'), '24.0.0.' || (abs(hashtext(p_first)) % 200)::text);
  return (select id from students where first_name = p_first and last_name = 'הפעלה');
end $$;
create or replace function t_ap_status(p_id uuid) returns text language sql as $$ select status::text from students where id = p_id $$;
create or replace function t_ap_pay(p_id uuid, p_amount numeric, p_method payment_method default 'credit', p_source text default 'manual') returns uuid
language sql as $$
  insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
  select id, branch_id, current_date, p_amount, p_method, p_source, 'בדיקה' from students where id = p_id returning id $$;
create or replace function t_ap_error(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  begin execute p_sql; exception when others then execute 'reset role'; return sqlerrm; end;
  execute 'reset role'; return null;
end $$;

update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'רישום ידני (אדל לוגסי):'
begin;
create temp table t_s as select t_ap_enroll('אדל') as id;
select assert_true(t_ap_status((select id from t_s)) = 'pending', 'נרשמה להוראת קבע — ממתינה');
select assert_true(t_ap_error(format('select rpc_renew_enrollment_link(%L)', (select id from t_s))) is null, 'עוד לא שילמה — "קישור הרשמה חדש" מותר');
select assert_eq((select count(*) from payment_links where student_id = (select id from t_s) and purpose = 'enrollment' and status in ('pending', 'opened')), 1,
                 'לפני התשלום: קישור הרשמה פתוח אחד');
select t_ap_pay((select id from t_s), 2100);
select assert_true(t_ap_status((select id from t_s)) = 'active', '★ שולמו 2,100 ₪ ברישום ידני — "פעילה"');
select assert_eq((select count(*) from payment_links where student_id = (select id from t_s) and purpose = 'enrollment' and status in ('pending', 'opened')), 0,
                 '★ ...וקישורי ההרשמה הפתוחים בוטלו (אחרת חיוב כפול)');
select assert_true((select after ->> 'payment_source' = 'manual' and (after ->> 'paid')::numeric = 2100 and after ->> 'first_charge' = '210'
                    from audit_log where action = 'activate_on_payment' and row_id = (select id from t_s)), '★ ביומן: למה עברה ל"פעילה"');
rollback;

\echo 'תשלום חלקי, ואז השלמה:'
begin;
create temp table t_s as select t_ap_enroll('רחל') as id;
select t_ap_pay((select id from t_s), 100);
select assert_true(t_ap_status((select id from t_s)) = 'pending', '★ 100 ₪ מתוך חיוב ראשון של 210 — עדיין ממתינה');
select assert_true((select not f_first_charge_covered(s) from students s where s.id = (select id from t_s)), 'f_first_charge_covered: 100 < 210 — לא');
select t_ap_pay((select id from t_s), 150);
select assert_true(t_ap_status((select id from t_s)) = 'active', '★ עוד 150 (סה"כ 250 ≥ 210) — פעילה');
rollback;

\echo 'תשלום שנמחק לא נחשב:'
begin;
create temp table t_s as select t_ap_enroll('ליבי') as id;
insert into payments (student_id, branch_id, paid_on, amount, method, source, note, deleted_at)
select id, branch_id, current_date, 2100, 'credit', 'manual', 'נמחק', now() from students where id = (select id from t_s);
select assert_true(t_ap_status((select id from t_s)) = 'pending', '★ תשלום מחוק — לא מעביר ל"פעילה"');
select t_ap_pay((select id from t_s), 50);
select assert_true(t_ap_status((select id from t_s)) = 'pending', '★ ...וגם לא נספר בתשלום הבא (50 < 210)');
rollback;

\echo '★ קישור ההרשמה עצמו (SUMIT) — הזרימה הרגילה לא נפגעת:'
begin;
create temp table t_s as select t_ap_enroll('שירה') as id;
create temp table t_l as select id, token, external_identifier from payment_links where student_id = (select id from t_s) and purpose = 'enrollment';
select rpc_standing_consent((select token from t_l), 20);
select rpc_record_sumit_payment((select external_identifier from t_l), 'P-AP', 210, now(), 'D-AP', 'external_identifier', '901', null);
select assert_true((select status = 'paid' from payment_links where id = (select id from t_l)), '★ הקישור ששולם — "שולם" (לא בוטל על ידי הטריגר)');
select assert_true(t_ap_status((select id from t_s)) = 'active', 'פעילה');
select assert_true(exists (select 1 from jsonb_array_elements(rpc_standing_orders_to_setup()) e where e ->> 'link_id' = (select id::text from t_l)),
                   '★ ...והוראת הקבע מוכנה ליצירה כרגיל');
rollback;

\echo 'קישור תשלום רגיל ששולם (חנה הן):'
begin;
create temp table t_s as select t_ap_enroll('חנה') as id;
-- כמו לפני 0046: קישור חוב על כל הסכום.
insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
select repeat('a', 60) || 'ap01', 'tl-ap-debt', id, branch_id, 2100, 'debt' from students where id = (select id from t_s);
select rpc_record_sumit_payment('tl-ap-debt', 'P-AP2', 2100, now(), 'D-AP2', 'external_identifier', '902', null);
select assert_true(t_ap_status((select id from t_s)) = 'active', '★ שולמו 2,100 ₪ בקישור רגיל — "פעילה"');
select assert_true((select status = 'paid' from payment_links where external_identifier = 'tl-ap-debt'), 'קישור החוב — "שולם"');
-- ★ גם אם הייתה חוזרת ל"ממתינה" — אין "קישור הרשמה חדש" למי שכבר שילמה.
update students set status = 'pending' where id = (select id from t_s);
select assert_true(t_ap_error(format('select rpc_renew_enrollment_link(%L)', (select id from t_s))) like 'המשפחה כבר שילמה את החיוב הראשון (2100 ₪ עד עכשיו)%',
                   '★ "קישור הרשמה חדש" למי שכבר שילמה — נדחה, עם הסבר');
select assert_true((select not f_enrollment_unpaid(s) from students s where s.id = (select id from t_s)), 'f_enrollment_unpaid: שילמה — לא "ממתינה לחיוב הראשון"');
rollback;

\echo 'מזומן:'
begin;
create temp table t_s as select t_ap_enroll('תהילה', 'cash') as id;
select assert_true(t_ap_status((select id from t_s)) = 'pending', 'נרשמה במזומן — ממתינה');
select t_ap_pay((select id from t_s), 600, 'cash');
select assert_true(t_ap_status((select id from t_s)) = 'active', '★ נרשם תשלום במזומן — "פעילה" ("ההרשמה תאושר כשהתשלום יירשם")');
rollback;

\echo 'כבר פעילה — שום דבר:'
begin;
create temp table t_s as select t_ap_enroll('מירב') as id;
update students set status = 'active' where id = (select id from t_s);
select t_ap_pay((select id from t_s), 2100);
select assert_eq((select count(*) from audit_log where action = 'activate_on_payment' and row_id = (select id from t_s)), 0, 'תלמידה פעילה — בלי רישום ביומן');
rollback;

select assert_no_execute('authenticated', 'f_first_charge_covered(students)');
select assert_no_execute('anon', 'f_first_charge_covered(students)');

update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function t_ap_enroll(text, text); drop function t_ap_status(uuid); drop function t_ap_pay(uuid, numeric, payment_method, text); drop function t_ap_error(text);
select drop_assert_helpers();
\echo '  "ממתינה" → "פעילה" כשהחיוב הראשון שולם: הכל עבר'
