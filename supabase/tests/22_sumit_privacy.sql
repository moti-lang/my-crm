-- 22_sumit_privacy.sql — SUMIT: רק התשלומים שלנו (0036).
\set ON_ERROR_STOP on
\set SHIRA '''dddddddd-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

\echo 'מזהה תשלום לקישור (חזרה מהדף / IPN):'
begin;
insert into payment_links (token, external_identifier, student_id, branch_id, amount, status)
values (repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', :SHIRA, :BEITAR, 300, 'opened'),
       (repeat('b', 64), 'tl-22222222-2222-2222-2222-222222222222', :SHIRA, :BEITAR, 300, 'opened');

select assert_true((select jsonb_array_length(rpc_payment_links_to_sync())) = 0, '★ קישורים פתוחים בלי מזהה — לא בסנכרון (אפס פניות ל-SUMIT)');
select assert_true(not (rpc_payment_link_candidate(repeat('a', 64), 'tl-other', '5001', '77', 'redirect') ->> 'ok')::boolean, '★ ExternalIdentifier שאינו של הקישור — נדחה');
select assert_true(not (rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '50x1', '77', 'redirect') ->> 'ok')::boolean, 'מזהה לא מספרי — נדחה');
select assert_true((rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '5001', '77', 'redirect') -> 'link' ->> 'payment_id') = '5001', 'מזהה תקין — נשמר על הקישור');
select assert_true((select jsonb_array_length(rpc_payment_links_to_sync())) = 1, 'ורק הוא בסנכרון');
select assert_true((rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '5001', '77', 'redirect') ->> 'ok')::boolean, 'אותו מזהה שוב — לא נספר כניסיון חדש');
select rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '5002', '77', 'redirect');
select rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '5003', '77', 'redirect');
select assert_true(not (rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '5004', '77', 'redirect') ->> 'ok')::boolean, '★ מזהה רביעי שונה מהדפדפן — נחסם (אין "ניחוש")');
select assert_true((rpc_payment_link_candidate(repeat('a', 64), 'tl-11111111-1111-1111-1111-111111111111', '5004', null, 'ipn') ->> 'ok')::boolean, 'מה-IPN (שרת SUMIT) — בלי מגבלת ניסיונות');
select rpc_payment_link_candidate_rejected(repeat('a', 64), 'בדיקה');
select assert_true((select sumit_pid_candidate is null from payment_links where token = repeat('a', 64)), 'מזהה שנדחה — נמחק מהקישור (לא נבדק שוב)');
select assert_true(exists (select 1 from system_alerts where kind = 'sumit_candidate_rejected' and meta ->> 'token' = repeat('a', 64)), '...והבעלים מקבלת התראה');
select assert_no_execute('anon', 'rpc_payment_link_candidate(text, text, text, text, text)');
select assert_no_execute('authenticated', 'rpc_payment_link_candidate(text, text, text, text, text)');

-- לקוחה מאומתת: מתשלום קודם שלנו של התלמידה.
update payment_links set status = 'paid', paid_at = now(), sumit_customer_id = '77' where token = repeat('b', 64);
select assert_true(f_student_sumit_customer(:SHIRA) = '77', 'הלקוחה ב-SUMIT מתשלום קודם שלנו — ידועה');
select assert_true((select f_link_ref(l) ->> 'known_customer_id' = '77' from payment_links l where token = repeat('a', 64)), 'f_link_ref: הקישור נושא את הלקוחה המאומתת לאימות');
rollback;

\echo 'IPN:'
begin;
select assert_true((rpc_sumit_ipn_received('application/json', '{"Customer":{"Name":"לקוח אחר","Phone":"0501234567"},"Amount":999}', '{"external_identifier":null}'::jsonb) -> 'link') = 'null'::jsonb, 'IPN של לקוח אחר — לא מזוהה כשלנו');
select assert_true((select body is null and candidates is null and content_type is null from sumit_ipn_log order by received_at desc limit 1), '★ IPN של לקוח אחר — הגוף לא נשמר (רק נספר)');
rollback;

\echo 'הוראות קבע — חיוב מזוהה מהלקוחה שלנו:'
begin;
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status) values ('eeeeeeee-0000-0000-0000-0000000000a1', repeat('c', 64), 'x-so', :SHIRA, :BEITAR, 100, 'paid');
insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments, installments_total, date_start, consent_text, consented_at, status, next_billing)
values ('eeeeeeee-0000-0000-0000-0000000000b1', :SHIRA, :BEITAR, 'eeeeeeee-0000-0000-0000-0000000000a1', 77, 4242, 100, 3, 4, current_date, 'אישור', now(), 'active', current_date);
select assert_true((select jsonb_array_length(rpc_standing_orders_to_check())) = 1, 'מועד חיוב היום — נבדקת');
-- נבדקה, SUMIT עוד לא חייבה (החיוב עדיין היום) — לא נבדקת שוב באותו יום, גם כשהיא "בפיגור".
select rpc_standing_order_status('eeeeeeee-0000-0000-0000-0000000000b1', 12, current_date, null);
select assert_true((select jsonb_array_length(rpc_standing_orders_to_check())) = 0, '★ מכסה: הוראה שנבדקה היום לא נבדקת שוב באותו יום, גם כשמועד החיוב הגיע');
update standing_orders set last_checked_at = null where id = 'eeeeeeee-0000-0000-0000-0000000000b1';
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-0000000000b1', 0, (current_date + 30), current_date);
select assert_eq((select count(*) from standing_order_charges where standing_order_id = 'eeeeeeee-0000-0000-0000-0000000000b1'), 1, '★ Date_PreviousBilling התקדם — חיוב אחד נרשם');
select assert_eq((select count(*) from payments where student_id = :SHIRA and note like 'הוראת קבע SUMIT%' and paid_on = current_date), 1, '...ותשלום אחד בכרטיס');
select assert_true((select jsonb_array_length(rpc_standing_orders_to_check())) = 0, '★ נבדקה עכשיו — לא שוב לפני 20 שעות (מכסה)');
update standing_orders set last_checked_at = now() - interval '21 hours' where id = 'eeeeeeee-0000-0000-0000-0000000000b1';
select assert_true((select jsonb_array_length(rpc_standing_orders_to_check())) = 0, '★ החיוב הבא בעוד חודש — לא נבדקת כל יום');
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-0000000000b1', 0, (current_date + 30), current_date);
select assert_eq((select count(*) from standing_order_charges where standing_order_id = 'eeeeeeee-0000-0000-0000-0000000000b1'), 1, '★ אותו תאריך שוב — לא נרשם פעמיים');
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-0000000000b1', 14, (current_date + 30), current_date + 30);
select assert_eq((select count(*) from standing_order_charges where standing_order_id = 'eeeeeeee-0000-0000-0000-0000000000b1'), 1, '★ סטטוס כישלון (14) — לא נרשם חיוב תקין');
select assert_true((select status = 'retrying' from standing_orders where id = 'eeeeeeee-0000-0000-0000-0000000000b1'), '...והמצב עודכן לניסיון חוזר (התראה)');
rollback;

\echo 'חיוב שכבר נרשם (במזהה אמיתי של SUMIT) — לא נרשם שוב:'
begin;
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status) values ('eeeeeeee-0000-0000-0000-0000000000a2', repeat('d', 64), 'x-so2', :SHIRA, :BEITAR, 100, 'paid');
insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments, installments_total, date_start, consent_text, consented_at, status)
values ('eeeeeeee-0000-0000-0000-0000000000b2', :SHIRA, :BEITAR, 'eeeeeeee-0000-0000-0000-0000000000a2', 77, 4343, 100, 3, 4, current_date - 1, 'אישור', now(), 'active');
-- כך נרשם חיוב לפני 0036: מזהה התשלום האמיתי, last_billing עוד לא עודכן.
select rpc_record_standing_charge('eeeeeeee-0000-0000-0000-0000000000b2', 2411999999, 100, (current_date - 1)::timestamptz, true, null);
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-0000000000b2', 0, current_date + 29, current_date - 1);
select assert_eq((select count(*) from standing_order_charges where standing_order_id = 'eeeeeeee-0000-0000-0000-0000000000b2'), 1, '★ חיוב שנרשם קודם במזהה אמיתי — לא נרשם שוב (אין חיוב כפול בכרטיס)');
rollback;
\echo '  כל בדיקות הפרטיות מול SUMIT עברו'
