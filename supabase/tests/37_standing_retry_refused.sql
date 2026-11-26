-- 37_standing_retry_refused.sql — "ניסיון חיוב חוזר" שלא בוצע כי ההוראה ב-SUMIT כבר לא מושבתת (0060).
--   המקרה (בנות הוכהייזר, 19/11): "חיוב חוזר" בממשק של SUMIT החזיר את ההוראה לפעילה (0); אצלנו
--   הניסיון סירב בצדק, אבל המסך נשאר "הושבתה אחרי כישלון" ולא נשאר תיעוד.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_rf_order() returns uuid language plpgsql as $$
declare v_link uuid := 'eeeeeeee-0000-0000-0000-000000000370'; v_id uuid := 'eeeeeeee-0000-0000-0000-000000000371';
begin
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
  values (v_link, repeat('f', 60) || '0370', 'rf-1', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
          210, 'paid', '2026-10-19 10:00+00');
  insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, consent_text, consented_at, status, sumit_status, next_billing, charged_count,
                               billing_day, last_checked_at)
  values (v_id, 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', v_link, 2538691184, 2539579999, 110,
          9, 10, '2026-11-19', 'אישור', '2026-10-19 10:00+00', 'failed', 3, '2026-11-19', 0, 19, now() - interval '3 hours');
  return v_id;
end $$;

\echo 'פעילה שוב ב-SUMIT (0) — לא חויב, המצב נקלט, ונרשם ביומן:'
begin;
select t_rf_order();
create temp table t_r as select rpc_standing_retry_refused('eeeeeeee-0000-0000-0000-000000000371', 0, '2026-11-19', null, '2027-07-19',
                                                          t_user('owner'::user_role)) as r;
select assert_true((select r ->> 'ok' = 'true' and r ->> 'status' = 'active' from t_r), '★ ההוראה אצלנו — "פעילה", כמו ב-SUMIT');
select assert_true((select status = 'active' and sumit_status = 0 and last_checked_at > now() - interval '1 minute'
                      from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000371'), '★ סטטוס SUMIT וזמן הבדיקה עודכנו מיד');
select assert_true((select kind = 'retry_refused' and actor = t_user('owner'::user_role) and from_date = '2026-11-19'
                           and note like 'לא חויב: ב-SUMIT ההוראה פעילה (קוד 0)%SUMIT תחייב בעצמה%'
                      from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000371'),
                   '★ ביומן: "חיוב חוזר לא בוצע" — מי, על איזה מועד, ולמה');
select assert_eq((select count(*) from payments where note like '%חיוב חוזר%' and student_id = 'dddddddd-0000-0000-0000-000000000001'
                    and created_at > now() - interval '1 minute'), 0, 'שום תשלום לא נרשם');
select assert_true(f_sumit_recurring_label(3) = 'הושבתה אחרי כישלון (קוד 3)' and f_sumit_recurring_label(99) = 'במצב לא מוכר (קוד 99)',
                   'f_sumit_recurring_label: שם המצב בעברית, עם הקוד');
rollback;

\echo 'במצב אחר (ניסיון חוזר של SUMIT, 14) — לא חויב, וההוראה נשארת לבדיקה:'
begin;
select t_rf_order();
select rpc_standing_retry_refused('eeeeeeee-0000-0000-0000-000000000371', 14, '2026-11-21', null, null, t_user('owner'::user_role));
select assert_true((select note like 'לא חויב: ב-SUMIT ההוראה ממתינה לניסיון חוזר (קוד 14)' from standing_order_events
                     where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000371'), 'ביומן: הסיבה (קוד 14), בלי "תחייב בעצמה במועד הבא"');
rollback;

select assert_no_execute('authenticated', 'rpc_standing_retry_refused(uuid, int, date, date, date, uuid)');
select assert_no_execute('anon', 'rpc_standing_retry_refused(uuid, int, date, date, date, uuid)');
drop function t_rf_order();
select drop_assert_helpers();
\echo '  ניסיון חיוב חוזר שלא בוצע: הכל עבר'
