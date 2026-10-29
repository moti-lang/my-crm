-- 26_billing_day.sql — יום החיוב בהוראת קבע (0041):
--   · שינוי יום חיוב: התאריך הבא בכל המקרים (חויבה החודש / לא חויבה / היום עבר / עוד לא הגיע),
--     משפט ברור לבעלים, ורק הבעלים.
--   · יום חיוב בהרשמה (1–28): הנוסח שההורה מאשרת מציג את היום ואת התאריכים בפועל,
--     וההוראה נוצרת בדיוק לפיהם.
--   · שינוי ידני ב-SUMIT: הסנכרון קולט, רושם ביומן, לא רושם חיוב ולא מתבלבל.
\set ON_ERROR_STOP on
\set SHIRA '''dddddddd-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

-- הוראה לבדיקה: קישור ששולם ב-p_paid (שעון ישראל, 10:00), ומצב ההוראה כפי שנתון.
create or replace function t_bd_order(p_n int, p_paid timestamptz, p_next date, p_last date, p_installments int, p_charged int,
                                      p_status text default 'active', p_day int default null) returns uuid
language plpgsql as $$
declare v_link uuid := ('eeeeeeee-0000-0000-0000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
        v_id uuid := ('eeeeeeee-0000-0000-0000-0000000002' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
  values (v_link, repeat(to_hex(p_n % 16), 60) || lpad(p_n::text, 4, '0'), 'bd-' || p_n, 'dddddddd-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001', 300, 'paid', p_paid);
  insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, consent_text, consented_at, status, next_billing, last_billing, charged_count, billing_day)
  values (v_id, 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', v_link, 77, 5000 + p_n, 100,
          p_installments, p_installments + 1, coalesce(p_last, p_next), 'אישור', p_paid, p_status, p_next, p_last, p_charged,
          coalesce(p_day, extract(day from p_next)::int));
  return v_id;
end $$;
create or replace function t_bd_plan(p_id uuid, p_day int, p_today date) returns jsonb language sql as $$
  select f_standing_reschedule_plan(p_id, p_day, p_today) $$;

\echo 'התאריך הבא — הכלל (טהור):'
select assert_true(f_standing_next_on_day(20, '2026-11-15', '2026-11-05') = '2026-12-20', '★ חויבה החודש (05/11) → ה-20 בחודש הבא (20/12)');
select assert_true(f_standing_next_on_day(20, '2026-11-15', '2026-10-25') = '2026-11-20', '★ לא חויבה החודש, וה-20 עוד לא הגיע → 20/11, החודש');
select assert_true(f_standing_next_on_day(10, '2026-11-15', '2026-10-25') = '2026-12-10', '★ לא חויבה החודש, וה-10 כבר עבר → 10/12, בחודש הבא');
select assert_true(f_standing_next_on_day(15, '2026-11-15', '2026-10-25') = '2026-12-15', '★ היום שנבחר הוא היום → בחודש הבא (לא חיוב "היום")');
select assert_true(f_standing_next_on_day(3, '2026-12-20', '2026-12-05') = '2027-01-03', 'מעבר שנה: חויבה בדצמבר → 03/01/2027');
select assert_true(f_standing_next_on_day(28, '2027-01-31', '2027-01-05') = '2027-02-28', 'פברואר: ה-28 קיים בכל חודש');
select assert_true(f_standing_next_on_day(20, '2026-11-15', null) = '2026-11-20', 'בלי שום חיוב קודם — כמו "לא חויבה החודש"');
select assert_true(f_standing_dates_on_day('2026-10-31', 1, 3) = '{2026-11-01,2026-12-01,2027-01-01}', 'בהרשמה: מהחודש שאחרי, ביום שנבחר');
select assert_true(f_standing_dates_on_day('2026-01-31', 20, 2) = '{2026-02-20,2026-03-20}', 'בהרשמה ב-31/01: 20/02, 20/03');
select assert_true(f_on_billing_day('2027-02-28', 31) and f_on_billing_day('2026-12-20', 20) and not f_on_billing_day('2026-12-21', 20), 'f_on_billing_day: ביום החיוב (חודש קצר — האחרון שלו)');
select assert_true(f_months_between('2026-12-20', '2027-06-20') = 6 and f_months_between('2026-11-30', '2026-12-01') = 1, 'f_months_between: לפי חודש ושנה');

\echo 'שינוי יום חיוב — התוכנית והמשפט לבעלים:'
begin;
-- 1. חויבה החודש בהוראה (Date_PreviousBilling 05/11). היום 15/11.
select t_bd_order(1, '2026-09-05 10:00+03', '2026-12-05', '2026-11-05', 9, 2);
select assert_true((t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'next')::date = '2026-12-20', '★ חויבה החודש → 20/12 (לא 20/11: אין שני חיובים בנובמבר)');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'kind' = 'charged_this_month', '...מסומן "חויבה החודש"');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'sentence'
                   = 'החיוב הבא יהיה ב-20/12, ואחריו כל 20 לחודש. נשארו 7 חיובים, האחרון ב-20/06/2027.', '★ המשפט לבעלים: התאריך הבא, היום בחודש, כמה נותרו והאחרון');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'reason' = 'כבר חויבה החודש (05/11), ולכן החיוב הבא בחודש הבא.', '...והסיבה במילים');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'current' = 'עכשיו: החיוב הבא ב-05/12, כל 5 לחודש.', '...ומה יש עכשיו');
select assert_true((t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'remaining')::int = 7
                   and (t_bd_plan('eeeeeeee-0000-0000-0000-000000000201', 20, '2026-11-15') ->> 'final')::date = '2027-06-20', '★ מספר החיובים לא משתנה — רק התאריכים');
-- 2. חויבה החודש בתשלום הראשון (הקישור, 02/11), עוד בלי חיוב בהוראה.
select t_bd_order(2, '2026-11-02 10:00+02', '2026-12-02', null, 9, 0);
select assert_true((t_bd_plan('eeeeeeee-0000-0000-0000-000000000202', 20, '2026-11-15') ->> 'next')::date = '2026-12-20', '★ התשלום הראשון החודש = חויבה החודש → 20/12');
-- 3. ★ שעון ישראל: שולם ב-01/11 בשעה 00:30 (ב-UTC עוד 31/10).
select t_bd_order(3, '2026-10-31 22:30+00', '2026-12-01', null, 9, 0);
select assert_true((t_bd_plan('eeeeeeee-0000-0000-0000-000000000203', 20, '2026-11-15') ->> 'next')::date = '2026-12-20', '★ שולם ב-00:30 ב-01/11 (שעון ישראל) — נחשב נובמבר, לא אוקטובר');
-- 4. לא חויבה החודש (אחרון 25/10), החיוב הבא 25/11.
select t_bd_order(4, '2026-08-25 10:00+03', '2026-11-25', '2026-10-25', 9, 2);
select assert_true((t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 20, '2026-11-15') ->> 'next')::date = '2026-11-20'
                   and t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 20, '2026-11-15') ->> 'kind' = 'day_ahead', '★ לא חויבה, היום שנבחר עוד לא הגיע → 20/11');
select assert_true((t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 10, '2026-11-15') ->> 'next')::date = '2026-12-10'
                   and t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 10, '2026-11-15') ->> 'kind' = 'day_passed', '★ לא חויבה, היום שנבחר כבר עבר → 10/12');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 10, '2026-11-15') ->> 'reason' = 'ה-10 לחודש כבר עבר החודש, ולכן החיוב הבא בחודש הבא.', '...והסיבה במילים');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 15, '2026-11-15') ->> 'reason' like 'ה-15 לחודש הוא היום%', 'היום שנבחר = היום — נאמר במפורש');
-- 5. חיוב אחד אחרון.
select t_bd_order(5, '2026-08-25 10:00+03', '2026-11-25', '2026-10-25', 3, 2);
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000205', 20, '2026-11-15') ->> 'sentence' = 'החיוב הבא והאחרון יהיה ב-20/11.', 'חיוב אחרון — "הבא והאחרון"');
-- 6. מעבר שנה.
select t_bd_order(6, '2026-08-05 10:00+03', '2027-01-05', '2026-12-05', 9, 4);
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000206', 3, '2026-12-20') ->> 'sentence' = 'החיוב הבא יהיה ב-03/01, ואחריו כל 3 לחודש. נשארו 5 חיובים, האחרון ב-03/05/2027.', 'דצמבר → ינואר בשנה הבאה');

\echo 'שינוי יום חיוב — מתי לא:'
-- ★ חיוב שמועדו היום (SUMIT אולי מחייבת עכשיו), או עבר ועוד לא נקלט.
select t_bd_order(7, '2026-08-15 10:00+03', '2026-11-15', '2026-10-15', 9, 2);
select assert_true(not (t_bd_plan('eeeeeeee-0000-0000-0000-000000000207', 20, '2026-11-15') ->> 'ok')::boolean
                   and t_bd_plan('eeeeeeee-0000-0000-0000-000000000207', 20, '2026-11-15') ->> 'error' like 'החיוב שתוכנן ל-15/11 עוד לא נקלט%', '★ חיוב מתוכנן להיום — לא משנים עד שנקלט');
select assert_true(not (t_bd_plan('eeeeeeee-0000-0000-0000-000000000207', 20, '2026-11-17') ->> 'ok')::boolean, '★ חיוב שעבר ועוד לא נקלט — לא משנים');
select t_bd_order(8, '2026-08-25 10:00+03', '2026-11-25', '2026-10-25', 9, 2, 'retrying');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000208', 20, '2026-11-15') ->> 'error' like 'יש חיוב שנדחה%', '★ חיוב שנדחה וממתין לניסיון חוזר — לא משנים');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 29, '2026-11-15') ->> 'error' = 'יום החיוב: בין 1 ל-28 בחודש'
                   and not (t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 0, '2026-11-15') ->> 'ok')::boolean
                   and not (t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', null, '2026-11-15') ->> 'ok')::boolean, 'יום 29 / 0 / ריק — נדחה');
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 25, '2026-11-15') ->> 'error' like 'החיוב הבא כבר ב-25/11/2026%', 'אותו יום — "אין מה לשנות"');
select t_bd_order(9, '2026-08-25 10:00+03', '2026-11-25', '2026-10-25', 3, 3);
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000209', 20, '2026-11-15') ->> 'error' like 'כל החיובים בהוראה כבר בוצעו%', 'כל החיובים בוצעו — אין מה לשנות');
update standing_orders set sumit_recurring_id = null where id = 'eeeeeeee-0000-0000-0000-000000000204';
select assert_true(t_bd_plan('eeeeeeee-0000-0000-0000-000000000204', 20, '2026-11-15') ->> 'error' = 'להוראה הזו אין מזהה ב-SUMIT', 'בלי מזהה ב-SUMIT — לא');
rollback;

\echo 'שינוי יום חיוב — הרשאות, ושמירה ביומן:'
begin;
select t_bd_order(11, now() - interval '70 days', (f_today_il() + 10), (f_today_il() - 20), 9, 2);
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_standing_reschedule_preview('eeeeeeee-0000-0000-0000-000000000211', 20) ? 'sentence')
                   or (rpc_standing_reschedule_preview('eeeeeeee-0000-0000-0000-000000000211', 20) ? 'error'), 'הבעלים מקבלת תוכנית (לפי היום בישראל)');
do $$ begin
  perform set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
  perform rpc_standing_reschedule_preview('eeeeeeee-0000-0000-0000-000000000211', 20);
  perform assert_true(false, '★ מנהלת סניף לא משנה יום חיוב');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlstate = '42501', '★ מנהלת סניף לא משנה יום חיוב');
end $$;
do $$ begin
  perform set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
  perform rpc_standing_reschedule_preview('eeeeeeee-0000-0000-0000-000000000211', 20);
  perform assert_true(false, '★ רואת חשבון לא משנה יום חיוב');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlstate = '42501', '★ רואת חשבון לא משנה יום חיוב');
end $$;
reset role;
-- אחרי ש-SUMIT אישרה (הפונקציה): התאריך אצלנו + יומן: מי, מתי, מאיזה תאריך לאיזה.
select rpc_standing_order_rescheduled('eeeeeeee-0000-0000-0000-000000000211', t_user('owner'::user_role), f_today_il() + 10, f_today_il() + 25, 20, 7);
select assert_true((select next_billing = f_today_il() + 25 and billing_day = 20 from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000211'), 'התאריך ויום החיוב עודכנו');
select assert_true((select kind = 'reschedule' and from_date = f_today_il() + 10 and to_date = f_today_il() + 25 and to_day = 20 and remaining = 7
                           and actor = t_user('owner'::user_role) and actor_label = (select full_name from profiles where id = t_user('owner'::user_role))
                           and created_at is not null
                    from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000211'), '★ ביומן: מי שינתה, מתי, מאיזה תאריך לאיזה');
select assert_eq((select count(*) from audit_log where action = 'reschedule_standing_order' and row_id = 'eeeeeeee-0000-0000-0000-000000000211'), 1, 'וגם ביומן הפעולות');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from v_standing_order_events), 1, 'מנהלת ביתר רואה ביומן את ההוראה של הסניף שלה');
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_eq((select count(*) from v_standing_order_events), 1, 'רואת חשבון רואה את היומן');
select assert_true((select billing_day = 20 and remaining = 7 from v_standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000211'), 'במסך: יום החיוב וכמה נותרו');
reset role;
select assert_no_table_privilege('anon', '{standing_order_events}');
select assert_no_execute('anon', 'rpc_standing_reschedule_preview(uuid, integer)');
select assert_no_execute('authenticated', 'rpc_standing_order_rescheduled(uuid, uuid, date, date, integer, integer)');
select assert_no_execute('authenticated', 'f_standing_reschedule_plan(uuid, integer, date)');
select assert_no_execute('authenticated', 'rpc_standing_billing_observed(uuid, integer, date, date, date)');
select assert_true(not has_table_privilege('authenticated', 'standing_order_events', 'insert')
                   and not has_table_privilege('authenticated', 'standing_order_events', 'update')
                   and not has_table_privilege('authenticated', 'standing_order_events', 'delete'), '★ היומן לא נכתב מהדפדפן — רק מהמסד');
rollback;

\echo 'שינוי ידני ב-SUMIT — הסנכרון קולט ולא מתבלבל:'
begin;
-- הוראה ב-5 לחודש: חויבה 05/11, הבאה 05/12. מישהי שינתה ב-SUMIT ל-20/12.
select t_bd_order(21, '2026-09-05 10:00+03', '2026-12-05', '2026-11-05', 9, 2);
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000221', 0, '2026-12-20', '2026-11-05', '2027-06-20');
select assert_true((select next_billing = '2026-12-20' and billing_day = 20 and charged_count = 2 from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000221'),
                   '★ התאריך החדש נקלט, יום החיוב 20 — ולא נרשם חיוב');
select assert_eq((select count(*) from standing_order_charges where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000221'), 0, '★ אין חיוב מדומה');
select assert_true((select kind = 'sumit_change' and from_date = '2026-12-05' and to_date = '2026-12-20' and from_day = 5 and to_day = 20 and actor is null
                           and actor_label like 'שינוי ב-SUMIT%' from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000221'),
                   '★ ביומן: שינוי ב-SUMIT, מ-05/12 ל-20/12');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_date_changed' and meta ->> 'standing_order_id' = 'eeeeeeee-0000-0000-0000-000000000221'), 1, 'הבעלים מקבלת הודעה');
-- אותו מצב שוב — שום דבר חדש.
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000221', 0, '2026-12-20', '2026-11-05', '2027-06-20');
select assert_eq((select count(*) from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000221'), 1, 'אותו מצב שוב — בלי רישום כפול');
-- ★ החיוב הבא נקלט כרגיל (20/12), והתאריך זז לחודש הבא ביום החדש — זה לא "שינוי".
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000221', 0, '2027-01-20', '2026-12-20', '2027-06-20');
select assert_true((select charged_count = 3 and next_billing = '2027-01-20' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000221'), '★ החיוב ב-20/12 נקלט כחיוב');
select assert_eq((select count(*) from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000221'), 1, '★ חיוב רגיל — לא נרשם כשינוי');
-- שינוי ידני שקרה לפני חיוב שלא ראינו: חויבה 20/01, והבא 07/02 (לא 20/02).
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000221', 0, '2027-02-07', '2027-01-20', '2027-06-07');
select assert_true((select from_date = '2027-02-20' and to_date = '2027-02-07' from standing_order_events
                    where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000221' order by created_at desc, from_date desc limit 1)
                   and (select charged_count = 4 and billing_day = 7 from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000221'),
                   '★ חיוב + תזוזה ביחד: החיוב נקלט, והשינוי נרשם (מ-20/02 ל-07/02)');
-- ★ אחרי שינוי דרך המערכת — הסנכרון רואה את אותו תאריך ולא רושם "שינוי ב-SUMIT".
select rpc_standing_order_rescheduled('eeeeeeee-0000-0000-0000-000000000221', t_user('owner'::user_role), '2027-02-07', '2027-02-15', 15, 5);
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000221', 0, '2027-02-15', '2027-01-20', '2027-06-15');
select assert_eq((select count(*) from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000221' and kind = 'sumit_change'), 2, '★ שינוי דרך המערכת — לא נרשם שוב כשינוי ב-SUMIT');
-- הוראה שהסתיימה (SUMIT ממשיכה להחזיר "חיוב הבא") / ניסיון חוזר — לא "שינוי".
select t_bd_order(22, '2026-09-05 10:00+03', '2026-12-05', '2026-11-05', 9, 2);
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000222', 14, '2026-12-09', '2026-11-05', null);
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000222', 9, '2027-01-05', '2026-11-05', null);
select assert_eq((select count(*) from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000222'), 0, 'ניסיון חוזר / הסתיימה — לא נרשם שינוי תאריך');
rollback;

\echo 'כמה חיובים נותרו — SUMIT מול התוכנית:'
begin;
select t_bd_order(31, '2026-09-05 10:00+03', '2026-12-05', '2026-11-05', 9, 2);
select assert_true((rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000231', 0, '2026-12-05', '2026-11-05', '2027-06-05') ->> 'remaining_ok')::boolean,
                   'נותרו 7 — גם לפי SUMIT (05/12 עד 05/06)');
select assert_true(not (rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000231', 0, '2026-12-05', '2026-11-05', '2027-05-05') ->> 'remaining_ok')::boolean,
                   '★ לפי SUMIT נותרו 6 — אי-התאמה');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_remaining_mismatch'), 1, '★ ...והבעלים מקבלת התראה');
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000231', 0, '2026-12-05', '2026-11-05', '2027-05-05');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_remaining_mismatch'), 1, 'פעם ביום, לא בכל בדיקה');
select assert_true((rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000231', 0, '2026-12-05', '2026-11-05', null) ->> 'remaining_ok') is null,
                   'בלי התאריך האחרון מ-SUMIT — "לא ידוע" (ושינוי יום חיוב לא יתבצע)');
rollback;

\echo 'יום חיוב בהרשמה:'
create or replace function t_bd_enroll(p_first text, p_day text, p_track text default 'so10') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'יום', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', '0521118' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'bd@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', p_track, 'whatsapp', 'yes', 'photo', 'yes', 'billing_day', p_day), '21.0.0.' || (abs(hashtext(p_first)) % 200)::text) $$;
create or replace function t_bd_link(p_first text) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  select l.id from payment_links l join students s on s.id = l.student_id where s.first_name = p_first and s.last_name = 'יום' $$;
update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';
begin;
select assert_true((t_bd_enroll('נעמה', '20') ->> 'ok')::boolean, 'הרשמה עם יום חיוב 20');
select assert_true((select (payment_track ->> 'billing_day')::int = 20 from students where first_name = 'נעמה' and last_name = 'יום'), '★ היום שנבחר נשמר במסלול של התלמידה');
select assert_true(rpc_payment_link_public((select token from payment_links where id = t_bd_link('נעמה'))) #>> '{standing,text}'
                   like 'אני מאשרת חיוב של 210 ש"ח היום, ו-9 חיובים חודשיים של 110 ש"ח, ב-20 בכל חודש, בתאריכים הבאים: %', '★ הנוסח שההורה מאשרת: היום שנבחר');
select assert_true(rpc_payment_link_public((select token from payment_links where id = t_bd_link('נעמה'))) #>> '{standing,text}'
                   like '%: ' || to_char(f_month_day((f_today_il() + interval '1 month')::date, 20), 'DD/MM/YYYY') || ', %'
                   || to_char(f_month_day((f_today_il() + interval '9 months')::date, 20), 'DD/MM/YYYY'),
                   '★ ...והתאריכים בפועל: ה-20 מהחודש הבא, ועד התשיעי');
select assert_true(f_standing_consent(t_bd_link('נעמה'), '2026-10-31') ->> 'text' like '%בתאריכים הבאים: 20/11/2026, 20/12/2026, 20/01/2027, %20/07/2027', 'הרשמה ב-31/10 → 20/11 עד 20/07');
select assert_eq((f_standing_consent(t_bd_link('נעמה'), '2026-10-31') ->> 'billing_day')::bigint, 20, 'יום החיוב גם בנתונים');
-- האישור: התאריך הראשון נשמר על הקישור. ההוראה נוצרת לפיו ובאותו יום.
select rpc_standing_consent((select token from payment_links where id = t_bd_link('נעמה')));
select assert_true((select standing_date_start = f_month_day((f_today_il() + interval '1 month')::date, 20) from payment_links where id = t_bd_link('נעמה')),
                   '★ ברגע האישור — התאריך הראשון נשמר כמו שהופיע בנוסח');
select assert_true((select f_link_standing_start(l) = l.standing_date_start from payment_links l where id = t_bd_link('נעמה')), 'f_link_standing_start: התאריך שאושר');
savepoint legacy;
update payment_links set standing_date_start = null where id = t_bd_link('נעמה');
select assert_true((select f_link_standing_start(l) = (l.standing_consented_at::date + interval '1 month')::date from payment_links l where id = t_bd_link('נעמה')),
                   'f_link_standing_start: אישור מלפני 0041 (בלי תאריך שמור) — חודש אחרי האישור, כמו קודם');
rollback to savepoint legacy;
select rpc_record_sumit_payment((select external_identifier from payment_links where id = t_bd_link('נעמה')), 'P-BD', 210, now(), 'D-BD', 'external_identifier', '888', null);
select assert_true((select (e ->> 'date_start')::date = f_month_day((f_today_il() + interval '1 month')::date, 20) from jsonb_array_elements(rpc_standing_orders_to_setup()) e
                    where e ->> 'link_id' = t_bd_link('נעמה')::text), '★ ליצירה ב-SUMIT: מהתאריך שאושר');
select rpc_standing_order_created(t_bd_link('נעמה'), true, 888, 6661, null);
select assert_true((select billing_day = 20 and date_start = next_billing and extract(day from date_start) = 20 from standing_orders where payment_link_id = t_bd_link('נעמה')),
                   '★ ההוראה: יום חיוב 20, החיוב הראשון בה ב-20');
-- כללים.
select assert_true(t_bd_enroll('הדס', '29') ->> 'error' = 'יום החיוב בהוראת הקבע: בין 1 ל-28 בחודש', '★ 29 — נדחה (לא קיים בכל חודש)');
select assert_true(not (t_bd_enroll('הדס', '0') ->> 'ok')::boolean and not (t_bd_enroll('הדס', 'x') ->> 'ok')::boolean and not (t_bd_enroll('הדס', '-3') ->> 'ok')::boolean, '0 / x / -3 — נדחה');
select assert_eq((select count(*) from students where first_name = 'הדס' and last_name = 'יום'), 0, 'בקשה שנדחתה — לא נוצרה תלמידה');
select assert_true((t_bd_enroll('הדס', '1') ->> 'ok')::boolean and (t_bd_enroll('אורי', '28') ->> 'ok')::boolean, '1 ו-28 — תקין');
select t_bd_enroll('תמר', '20', 'card1');
select assert_true((select payment_track ? 'billing_day' = false from students where first_name = 'תמר' and last_name = 'יום'), 'תשלום אחד — יום חיוב לא נשמר');
select t_bd_enroll('יעל', '');
select assert_true(rpc_payment_link_public((select token from payment_links where id = t_bd_link('יעל'))) #>> '{standing,text}'
                   like 'אני מאשרת חיוב של 210 ש"ח היום, ו-9 חיובים חודשיים של 110 ש"ח בתאריכים הבאים: %', 'בלי בחירה — הנוסח כמו קודם');
rollback;
update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';

drop function if exists t_bd_order(int, timestamptz, date, date, int, int, text, int);
drop function if exists t_bd_plan(uuid, int, date);
drop function if exists t_bd_enroll(text, text, text);
drop function if exists t_bd_link(text);
\echo '  יום החיוב בהוראת קבע: הכל עבר'
