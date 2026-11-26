-- 39_standing_card_replace.sql — "קישור להחלפת כרטיס" להוראה שהושבתה (0062).
--   המקרה (22/11): ניסיון חיוב חוזר על הכרטיס השמור נדחה (004 / כרטיס מדווח כגנוב). צריך כרטיס אחר מההורה.
--   ההורה משלמת בקישור את החיוב שנכשל בכרטיס החדש, וההוראה ממשיכה עליו — אותו "חיוב X מתוך N".
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_cr_order(p_charged int default 0) returns uuid language plpgsql as $$
declare v_link uuid := 'eeeeeeee-0000-0000-0000-000000000390'; v_id uuid := 'eeeeeeee-0000-0000-0000-000000000391';
begin
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
  values (v_link, repeat('9', 60) || '0390', 'cr-1', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
          210, 'paid', (f_today_il() - 34)::timestamptz);
  insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, consent_text, consented_at, status, sumit_status, next_billing, charged_count, billing_day)
  values (v_id, 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', v_link, 2538691184, 2539578888, 110,
          9, 10, f_today_il() - 3, 'אישור', now() - interval '34 days', 'failed', 3, f_today_il() - 3, p_charged, 19);
  return v_id;
end $$;
create or replace function t_cr(p_sql text, p_role user_role default 'owner') returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;
create or replace function t_cr_link() returns payment_links language sql as $$
  select * from payment_links where purpose = 'card_replace' order by created_at desc limit 1
$$;

\echo 'קישור להחלפת כרטיס — מהשליחה ועד ההוראה החדשה:'
begin;
select t_cr_order();
select assert_true(t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391'), 'branch_manager') like 'ERROR: רק הבעלים%',
                   '★ מנהלת סניף — לא');
create temp table t_r as select t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391'))::jsonb as r;
select assert_true((select (r ->> 'amount')::numeric = 110 and (r ->> 'remaining_after')::int = 8 and r ->> 'url' like '%/pay/%' from t_r),
                   '★ הקישור: 110 (החיוב שנכשל), ואחריו עוד 8');
select assert_true((select amount = 110 and standing_amount = 110 and standing_installments = 8 and status = 'pending'
                           and replaces_standing_order_id = 'eeeeeeee-0000-0000-0000-000000000391' from t_cr_link()),
                   'נשמר: מה מחליפים, כמה חיובים ובכמה');
select assert_true((select r.body like '%לא עבר בכרטיס השמור%' and r.body like '%110 ₪%' and r.body like '%עוד 8 תשלומים, מהחודש הבא%'
                      from reminders r where r.id = (t_cr_link()).reminder_id), 'הודעה להורה: למה, כמה, ומה ממשיך');
select assert_true((select count(*) = 1 from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000391' and kind = 'card_link'),
                   'ביומן ההוראה: "נשלח קישור להחלפת כרטיס"');
-- ★ דף ההורה: אישור הוראת הקבע — 8 חיובים של 110, מהחודש הבא, ביום שהיא בוחרת.
select assert_true((select (c ->> 'first')::numeric = 110 and (c ->> 'count')::int = 8 and (c ->> 'each')::numeric = 110
                           and (c ->> 'billing_day')::int = 5 and (c -> 'dates' ->> 0)::date > f_today_il()
                           and (c -> 'dates' ->> 0)::date >= date_trunc('month', f_today_il() + interval '1 month')::date
                           and c ->> 'text' like 'אני מאשרת חיוב של 110 ש"ח היום, ו-8 חיובים חודשיים של 110 ש"ח, ב-5 בכל חודש%'
                      from (select f_standing_consent((t_cr_link()).id, f_today_il(), 5) c) x),
                   '★ נוסח האישור: 110 היום, ו-8 × 110 מהחודש הבא, ביום שנבחר');
select assert_true((select (f_standing_consent((t_cr_link()).id) ->> 'billing_day')::int = 19), 'בלי בחירה — היום של ההוראה הקודמת');
select assert_true(rpc_standing_consent_required((t_cr_link()).token), '★ בלי אישור — אין דף תשלום');
select assert_true((rpc_standing_consent((t_cr_link()).token, 5) ->> 'ok')::boolean, 'ההורה אישרה (יום 5)');
-- ההורה שילמה בכרטיס החדש.
select assert_true((rpc_record_sumit_payment((t_cr_link()).external_identifier, 'cr-pay-1', 110, now(), null, 'external_identifier', '7770001', null) ->> 'ok')::boolean,
                   'התשלום נקלט');
select assert_true((select count(*) = 1 from payments where student_id = 'dddddddd-0000-0000-0000-000000000001' and amount = 110 and source = 'sumit'
                      and paid_on = f_today_il()), '★ 110 נרשמו בכרטיס התלמידה');
select assert_true((select status = 'cancelled' and charged_count = 0 and not needs_renewal and last_error like 'הכרטיס הוחלף%'
                      from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000391'),
                   '★ ההוראה הישנה נסגרה מיד — אין עליה "ניסיון חיוב חוזר" (חיוב כפול)');
select assert_true(t_cr(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000391', f_today_il(), 'x')) like 'ERROR: רק בהוראה שהושבתה%',
                   'וגם לא "שולם בנפרד"');
select assert_true(not (f_standing_retry_plan('eeeeeeee-0000-0000-0000-000000000391', f_today_il()) ->> 'ok')::boolean, 'ולא תוכנית חיוב חוזר');
-- הסנכרון: הוראה חדשה על הכרטיס החדש, והישנה לביטול ב-SUMIT.
select assert_true((select (x ->> 'amount')::numeric = 110 and (x ->> 'installments')::int = 8 and (x ->> 'installments_total')::int = 10
                           and x ->> 'customer_id' = '7770001' and (x ->> 'replaces_recurring_id')::bigint = 2539578888
                           and (x ->> 'replaces_customer_id')::bigint = 2538691184 and (x ->> 'date_start')::date = (t_cr_link()).standing_date_start
                      from jsonb_array_elements(rpc_standing_orders_to_setup()) x where x ->> 'link_id' = (t_cr_link()).id::text),
                   '★ לסנכרון: 8 × 110 על הלקוחה החדשה מ-SUMIT, ומה לבטל');
select rpc_standing_order_created((t_cr_link()).id, true, 7770001, 3000000001, null);
select assert_true((select status = 'active' and amount = 110 and installments = 9 and charged_count = 1 and installments_total = 10
                           and billing_day = 5 and next_billing = (t_cr_link()).standing_date_start and sumit_recurring_id = 3000000001
                      from standing_orders where payment_link_id = (t_cr_link()).id),
                   '★ ההוראה החדשה: נותרו 8, יום 5');
select assert_true((select charged_total = 2 and remaining = 8 from v_standing_orders where id = (select id from standing_orders where payment_link_id = (t_cr_link()).id)),
                   '★ "חיוב 2 מתוך 10" — ממשיך מאותו מקום');
select assert_true((select last_error = 'הוחלפה בהוראה על כרטיס חדש' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000391'), 'הישנה: "הוחלפה"');
select assert_true((select count(*) = 2 from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000391' and kind = 'card_replaced'),
                   'ביומן הישנה: התשלום, וההוראה החדשה');
select assert_true(not exists (select 1 from jsonb_array_elements(rpc_standing_orders_to_setup()) x where x ->> 'link_id' = (t_cr_link()).id::text),
                   'לא נוצרת פעמיים');
rollback;

\echo 'החיוב האחרון — בלי הוראה חדשה:'
begin;
select t_cr_order(8);
select assert_true((t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391'))::jsonb ->> 'remaining_after')::int = 0, 'אחרי הקישור — 0');
select assert_true(f_standing_consent((t_cr_link()).id) is null and not rpc_standing_consent_required((t_cr_link()).token), '★ אין אישור הוראת קבע (תשלום אחד)');
select assert_true((select r.body not like '%ממשיכה%' from reminders r where r.id = (t_cr_link()).reminder_id), 'בהודעה — בלי "ממשיכה"');
select rpc_record_sumit_payment((t_cr_link()).external_identifier, 'cr-pay-2', 110, now(), null, 'external_identifier', '7770002', null);
select assert_true((select status = 'completed' and charged_count = 9 and next_billing is null from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000391'),
                   '★ ההוראה הסתיימה — חיוב 10 מתוך 10');
select assert_true(not exists (select 1 from jsonb_array_elements(rpc_standing_orders_to_setup()) x where x ->> 'link_id' = (t_cr_link()).id::text),
                   'ולא נוצרת הוראה חדשה');
rollback;

\echo 'החיוב טופל בדרך אחרת — הקישור הפתוח מתבטל:'
begin;
select t_cr_order();
select t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391'));
select t_cr(format('select rpc_standing_paid_elsewhere(%L, %L, %L)::text', 'eeeeeeee-0000-0000-0000-000000000391', f_today_il(), 'חיוב ידני'));
select assert_true((select status = 'cancelled' from t_cr_link()), '★ "שולם בנפרד" — הקישור להחלפת כרטיס בוטל');
rollback;
begin;
select t_cr_order();
select t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391'));
select rpc_standing_consent((t_cr_link()).token, 5);
update standing_orders set status = 'active', sumit_status = 0 where id = 'eeeeeeee-0000-0000-0000-000000000391';
select assert_true((select status = 'cancelled' from t_cr_link()), 'הופעלה שוב ב-SUMIT — הקישור בוטל');
-- ★ ואם בכל זאת שולם (דף SUMIT שכבר היה פתוח): לא נוגעים בהוראה, והבעלים יודעת.
select rpc_record_sumit_payment((t_cr_link()).external_identifier, 'cr-pay-3', 110, now(), null, 'external_identifier', '7770003', null);
select assert_true((select status = 'active' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000391'), 'ההוראה הפעילה לא נסגרה');
select assert_true(exists (select 1 from system_alerts where kind = 'card_replace_conflict' and severity = 'critical'), '★ התראה: ייתכן חיוב כפול');
select assert_true(not exists (select 1 from jsonb_array_elements(rpc_standing_orders_to_setup()) x where x ->> 'link_id' = (t_cr_link()).id::text),
                   'ולא נוצרת הוראה שנייה');
rollback;

\echo 'מתי אי אפשר:'
begin;
select t_cr_order();
update standing_orders set status = 'active', sumit_status = 0 where id = 'eeeeeeee-0000-0000-0000-000000000391';
select assert_true(t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391')) like 'ERROR: קישור להחלפת כרטיס — רק בהוראה שהושבתה%', 'פעילה — לא');
update standing_orders set status = 'failed', sumit_status = 3, retry_uncertain_at = now() where id = 'eeeeeeee-0000-0000-0000-000000000391';
select assert_true(t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391')) like 'ERROR: בניסיון החיוב החוזר האחרון לא ברור%',
                   '★ ניסיון קודם שלא ברור אם חויב — לא');
update standing_orders set retry_uncertain_at = null where id = 'eeeeeeee-0000-0000-0000-000000000391';
update students set parent_phone = null where id = 'dddddddd-0000-0000-0000-000000000001';
select assert_true(t_cr(format('select rpc_standing_card_link(%L)::text', 'eeeeeeee-0000-0000-0000-000000000391')) like 'ERROR: לתלמידה אין טלפון%', 'בלי טלפון — לא');
rollback;

select assert_no_execute('anon', 'rpc_standing_card_link(uuid)');
select assert_no_execute('authenticated', 'f_card_replace_paid()');
select assert_no_execute('authenticated', 'f_card_links_obsolete()');
select assert_no_execute('authenticated', 'rpc_standing_orders_to_setup()');
drop function t_cr_order(int); drop function t_cr(text, user_role); drop function t_cr_link();
select drop_assert_helpers();
\echo '  קישור להחלפת כרטיס: הכל עבר'
