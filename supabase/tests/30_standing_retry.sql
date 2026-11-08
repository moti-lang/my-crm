-- 30_standing_retry.sql — ניסיון חיוב חוזר בהוראת קבע שהושבתה אחרי חיוב שנכשל (0048).
--   המקרה (תמר וינשטוק, 6/11): החיוב החודשי נדחה, SUMIT השביתה את ההוראה (3). הכרטיס שמור אצלה.
--   · התוכנית: כמה, מה יקרה אם יעבור (הוראה חדשה לחיובים שנותרו מהחודש הבא) ואם לא. רק הבעלים.
--   · עבר: תשלום, "חיוב X מתוך N", יומן; "צריך לחדש" עד שההוראה החדשה נוצרת.
--   · נדחה: הסיבה ביומן, ושום דבר אחר לא משתנה.
--   · חידוש: מזהה ההוראה החדש, פעילה, הסנכרון ממשיך ממנה — בלי לרשום חיוב כפול.
\set ON_ERROR_STOP on
\set SHIRA '''dddddddd-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

-- הוראה שהושבתה: 8 תשלומים (7 בהוראה), p_charged חויבו, החיוב של 06/11 נכשל, יום 6.
create or replace function t_rt_order(p_n int, p_charged int default 0, p_status text default 'failed', p_installments int default 7, p_day int default 6) returns uuid
language plpgsql as $$
declare v_link uuid := ('eeeeeeee-0000-0000-0000-0000000003' || lpad(p_n::text, 2, '0'))::uuid;
        v_id uuid := ('eeeeeeee-0000-0000-0000-0000000004' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
  values (v_link, repeat('c', 60) || lpad(p_n::text, 4, '0'), 'rt-' || p_n, 'dddddddd-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001', 241, 'paid', '2026-10-29 21:55+00');
  insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments,
                               installments_total, date_start, consent_text, consented_at, status, sumit_status, next_billing, charged_count, billing_day)
  values (v_id, 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', v_link, 2538691184, 2539572900 + p_n, 137,
          p_installments, p_installments + 1, '2026-11-06', 'אישור', '2026-10-29 21:55+00', p_status,
          case p_status when 'failed' then 3 when 'retrying' then 14 else 0 end, make_date(2026, case when p_day > 8 then 10 else 11 end, p_day), p_charged, p_day);
  return v_id;
end $$;
create or replace function t_rt_plan(p_id uuid) returns jsonb language sql as $$ select f_standing_retry_plan(p_id, '2026-11-08') $$;
create or replace function t_rt_preview(p_id uuid, p_role user_role) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin perform rpc_standing_retry_preview(p_id); exception when others then execute 'reset role'; return sqlerrm; end;
  execute 'reset role'; return null;
end $$;

\echo 'התוכנית (לפני הלחיצה):'
begin;
select t_rt_order(1);
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'stage' = 'charge'
                   and (t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'amount')::numeric = 137, '★ חיוב חוזר של 137 ₪ (הסכום החודשי)');
select assert_true((t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'next')::date = '2026-12-06'
                   and (t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'remaining_after')::int = 6
                   and (t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'final')::date = '2027-05-06',
                   '★ אם יעבור: 6 חיובים שנותרו, מ-06/12 (לא שוב בנובמבר), עד 06/05/2027');
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') -> 'lines' = jsonb_build_array(
                     'ננסה לחייב עכשיו 137 ₪ בכרטיס השמור של ההורה — החיוב של 06/11 שנכשל.',
                     'אם יעבור: ההוראה תחודש ב-SUMIT: 6 חיובים של 137 ₪, מ-06/12, כל 6 לחודש (האחרון ב-06/05/2027).',
                     'אם לא יעבור: שום דבר לא משתנה, ותופיע הסיבה מחברת האשראי.'),
                   '★ במילים, לבעלים: כמה, על איזה חיוב, מה יקרה אם יעבור ואם לא');
select assert_true(t_rt_preview('eeeeeeee-0000-0000-0000-000000000401', 'owner') is null, 'הבעלים — רואה');
select assert_true(t_rt_preview('eeeeeeee-0000-0000-0000-000000000401', 'branch_manager') like '%רק הבעלים%', '★ מנהלת סניף — לא');
select assert_true(t_rt_preview('eeeeeeee-0000-0000-0000-000000000401', 'accountant') like '%רק הבעלים%', '★ רואת חשבון — לא');
select t_rt_order(2, 0, 'active'), t_rt_order(3, 0, 'retrying'), t_rt_order(4, 7);
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000402') ->> 'error' = 'ההוראה פעילה — אין חיוב שנכשל לנסות שוב', '★ הוראה פעילה — אין מה לנסות');
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000403') ->> 'error' like 'SUMIT עוד מנסה לחייב בעצמה%', '★ SUMIT עוד מנסה בעצמה — לא במקביל');
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000404') ->> 'error' = 'כל החיובים בהוראה כבר בוצעו', 'כל החיובים בוצעו — אין מה לנסות');
update standing_orders set sumit_recurring_id = null where id = 'eeeeeeee-0000-0000-0000-000000000401';
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'error' = 'להוראה הזו אין מזהה ב-SUMIT', 'בלי מזהה ב-SUMIT — לא');
rollback;

\echo 'החיוב עבר — ואז החידוש:'
begin;
select t_rt_order(1);
create temp table t_r as select rpc_standing_retry_charged('eeeeeeee-0000-0000-0000-000000000401', 9001, 137, '2026-11-08 10:00+02', true, ' (קוד 000)', t_user('owner')) as r;
select assert_true((select (r ->> 'valid')::boolean and (r ->> 'remaining')::int = 6 from t_r), '★ נרשם: עבר, נותרו 6');
select assert_true((select count(*) = 1 and sum(amount) = 137 and bool_and(method = 'credit' and note = 'הוראת קבע SUMIT · חיוב חוזר (במקום 06/11) · חיוב 2 מתוך 8')
                    from payments where student_id = :SHIRA and note like '%חיוב חוזר%'), '★ תשלום של 137 ₪ בכרטיס התלמידה: "חיוב חוזר · חיוב 2 מתוך 8"');
select assert_true((select charged_count = 1 and needs_renewal and status = 'failed' and last_billing = '2026-11-08'
                     and last_error = 'החיוב החוזר עבר; ההוראה ב-SUMIT עוד לא חודשה'
                    from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000401'), '★ ההוראה: חויבה, ו"צריך לחדש" עד שתיווצר הוראה חדשה');
select assert_true((select kind = 'retry_charge' and from_date = '2026-11-06' and to_amount = 137 and remaining = 6 and actor = t_user('owner')
                    from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000401'), '★ ביומן: חיוב חוזר, על איזה חיוב, כמה, מי');
select assert_true((rpc_standing_retry_charged('eeeeeeee-0000-0000-0000-000000000401', 9001, 137, '2026-11-08 10:00+02', true, null, t_user('owner')) ->> 'duplicate')::boolean
                   and (select count(*) from payments where student_id = :SHIRA and note like '%חיוב חוזר%') = 1, 'אותו תשלום פעמיים — נרשם פעם אחת');
-- ★ עכשיו רק חידוש — בלי חיוב נוסף.
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'stage' = 'renew'
                   and (t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'next')::date = '2026-12-06'
                   and (t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'remaining_after')::int = 6
                   and t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') -> 'lines' ->> 0 = 'החיוב החוזר כבר עבר ונרשם. נשאר לחדש את ההוראה ב-SUMIT — בלי חיוב נוסף.',
                   '★ אחרי החיוב: רק "חידוש" — 6 חיובים מ-06/12, בלי חיוב נוסף');
-- הסנכרון של ההוראה הישנה כותב תאריך חיוב ישן — החידוש עדיין לא מחייב שוב בנובמבר.
update standing_orders set last_billing = '2026-10-29' where id = 'eeeeeeee-0000-0000-0000-000000000401';
select assert_true((t_rt_plan('eeeeeeee-0000-0000-0000-000000000401') ->> 'next')::date = '2026-12-06', '★ גם אם הסנכרון החזיר תאריך ישן — הבא ב-06/12, לא שוב בנובמבר');
-- ★ יום חיוב שעוד לפנינו החודש (20): בלי החיוב החוזר בחשבון, ההוראה החדשה הייתה מחייבת שוב ב-20/11.
select t_rt_order(7, 0, 'failed', 7, 20);
select rpc_standing_retry_charged('eeeeeeee-0000-0000-0000-000000000407', 9007, 137, '2026-11-08 10:00+02', true, null, t_user('owner'));
update standing_orders set last_billing = '2026-09-20' where id = 'eeeeeeee-0000-0000-0000-000000000407';
select assert_true((t_rt_plan('eeeeeeee-0000-0000-0000-000000000407') ->> 'next')::date = '2026-12-20',
                   '★ יום 20, חויבה ב-08/11, והסנכרון החזיר תאריך ישן — החידוש מ-20/12, לא שוב ב-20/11');
select assert_true(rpc_standing_retry_renewed('eeeeeeee-0000-0000-0000-000000000401', 2600000001, '2026-12-06', 5, t_user('owner')) ->> 'error' like 'מספר החיובים שנותרו השתנה%',
                   'חידוש עם מספר חיובים שגוי — נדחה');
select assert_true((rpc_standing_retry_renewed('eeeeeeee-0000-0000-0000-000000000401', 2600000001, '2026-12-06', 6, t_user('owner')) ->> 'ok')::boolean, 'החידוש נרשם');
select assert_true((select status = 'active' and sumit_recurring_id = 2600000001 and not needs_renewal and next_billing = '2026-12-06' and last_error is null
                    from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000401'), '★ ההוראה: פעילה, עם המזהה החדש ב-SUMIT, החיוב הבא 06/12');
select assert_true((select kind = 'renewed' and to_date = '2026-12-06' and to_day = 6 and remaining = 6 and note = 'הוראה חדשה ב-SUMIT (2600000001) במקום 2539572901 שהושבתה'
                    from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000401' and kind = 'renewed'), '★ ביומן: חודשה — מתי, כמה, והמזהה החדש במקום הישן');
select assert_true(rpc_standing_retry_renewed('eeeeeeee-0000-0000-0000-000000000401', 2600000002, '2026-12-06', 6, t_user('owner')) ->> 'error' like 'אין מה לחדש%', 'חידוש שני — נדחה');
-- הסנכרון ממשיך מההוראה החדשה: ממתינה לחיוב הראשון — פעילה, נותרו 6 גם לפי SUMIT, בלי חיוב כפול.
select assert_true((rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000401', 12, '2026-12-06', null, '2027-05-06') ->> 'remaining_ok')::boolean,
                   '★ הסנכרון אחרי החידוש: נותרו 6 גם לפי SUMIT');
select assert_true((select status = 'active' and charged_count = 1 from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000401'), '...פעילה, ולא נרשם חיוב נוסף');
-- החיוב הראשון בהוראה החדשה (06/12) נקלט כרגיל.
select rpc_standing_billing_observed('eeeeeeee-0000-0000-0000-000000000401', 0, '2027-01-06', '2026-12-06', '2027-05-06');
select assert_true((select charged_count = 2 and last_billing = '2026-12-06' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000401'), '★ החיוב של 06/12 בהוראה החדשה נקלט: חיוב 3 מתוך 8');
select set_config('request.jwt.claims', t_claims('owner'), true);
set local role authenticated;
select assert_true((select string_agg(kind || ':' || coalesce(note, ''), ',' order by created_at, kind) from v_standing_order_events
                    where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000401')
                   = 'renewed:הוראה חדשה ב-SUMIT (2600000001) במקום 2539572901 שהושבתה,retry_charge:', '★ במסך (v_standing_order_events, כבעלים): החיוב החוזר והחידוש, עם ההערה');
reset role;
rollback;

\echo 'החיוב נדחה:'
begin;
select t_rt_order(5);
select assert_true(not (rpc_standing_retry_charged('eeeeeeee-0000-0000-0000-000000000405', 9002, 137, '2026-11-08 10:00+02', false, ' סירוב (קוד 004)', t_user('owner')) ->> 'valid')::boolean, 'נרשם: נדחה');
select assert_true((select charged_count = 0 and failed_count = 1 and not needs_renewal and status = 'failed' and last_error = 'ניסיון חוזר נדחה: סירוב (קוד 004)'
                    from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000405'), '★ נדחה: שום דבר לא חויב ולא חודש; הסיבה מחברת האשראי');
select assert_eq((select count(*) from payments where student_id = :SHIRA and note like '%חיוב חוזר%'), 0, '★ אין תשלום');
select assert_true((select kind = 'retry_declined' and note = 'סירוב (קוד 004)' from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-000000000405'), '★ ביומן: נדחה, והסיבה');
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000405') ->> 'stage' = 'charge', 'אפשר לנסות שוב (למשל אחרי שההורה עדכנה את הכרטיס)');
rollback;

\echo 'לא ברור אם חויב (החיבור נפל):'
begin;
select t_rt_order(8);
select assert_true((rpc_standing_retry_uncertain('eeeeeeee-0000-0000-0000-000000000408', 'fetch failed', t_user('owner')) ->> 'ok')::boolean, 'נרשם: לא ברור');
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000408') ->> 'error' like 'בניסיון הקודם (%) לא ברור אם החיוב בוצע. לבדוק ב-SUMIT%',
                   '★ אין ניסיון נוסף (חיוב כפול) — קודם בודקים ב-SUMIT');
select assert_true((select last_error like 'ניסיון חוזר: לא ברור אם חויב (fetch failed)%' from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000408'), 'בכרטיס ההוראה: לא ברור, לבדוק');
update standing_orders set retry_uncertain_at = now() - interval '25 hours' where id = 'eeeeeeee-0000-0000-0000-000000000408';
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000408') ->> 'stage' = 'charge', 'אחרי 24 שעות — אפשר לנסות שוב');
select rpc_standing_retry_charged('eeeeeeee-0000-0000-0000-000000000408', 9008, 137, '2026-11-08 10:00+02', false, 'סירוב', t_user('owner'));
select assert_true((select retry_uncertain_at is null from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000408'), 'תשובה ברורה מ-SUMIT מנקה את "לא ברור"');
rollback;

\echo 'החיוב האחרון:'
begin;
select t_rt_order(6, 6);
select assert_true(t_rt_plan('eeeeeeee-0000-0000-0000-000000000406') -> 'lines' ->> 1 = 'אם יעבור: זה החיוב האחרון בהוראה — אין מה לחדש.', 'בתוכנית: החיוב האחרון — אין מה לחדש');
select assert_true((rpc_standing_retry_charged('eeeeeeee-0000-0000-0000-000000000406', 9003, 137, '2026-11-08 10:00+02', true, null, t_user('owner')) ->> 'remaining')::int = 0, 'נותרו 0');
select assert_true((select status = 'completed' and next_billing is null and not needs_renewal and last_error is null
                    from standing_orders where id = 'eeeeeeee-0000-0000-0000-000000000406'), '★ החיוב האחרון עבר — ההוראה הסתיימה, בלי חידוש');
rollback;

\echo 'הרשאות:'
select assert_no_execute('anon', 'rpc_standing_retry_preview(uuid)');
select assert_no_execute('authenticated', 'rpc_standing_retry_charged(uuid, bigint, numeric, timestamptz, boolean, text, uuid)');
select assert_no_execute('authenticated', 'rpc_standing_retry_renewed(uuid, bigint, date, integer, uuid)');
select assert_no_execute('authenticated', 'f_standing_retry_plan(uuid, date)');
select assert_no_execute('authenticated', 'rpc_standing_retry_uncertain(uuid, text, uuid)');

drop function t_rt_order(int, int, text, int, int); drop function t_rt_plan(uuid); drop function t_rt_preview(uuid, user_role);
select drop_assert_helpers();
\echo '  ניסיון חיוב חוזר בהוראת קבע: הכל עבר'
