-- 18_standing_orders.sql — הוראת קבע (סבב 3): אישור מפורש בנוסח המלא, יצירה
-- אחרי החיוב הראשון, חיובים נקלטים ליתרה, חיוב שנדחה → התראה בלי להוריד
-- את התלמידה, עצירה רק אחרי ש-SUMIT ביטלה.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_so_enroll(p_first text, p_track text default 'so10') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'קבע', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', '0521119' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'so@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', p_track, 'whatsapp', 'yes', 'photo', 'yes'), '20.0.0.' || (abs(hashtext(p_first)) % 200)::text) $$;
create or replace function t_so_token(p_first text) returns text
language sql security definer set search_path = public, pg_temp as $$
  select l.token from payment_links l join students s on s.id = l.student_id where s.first_name = p_first and s.last_name = 'קבע' $$;
create or replace function t_so_link(p_first text) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  select l.id from payment_links l join students s on s.id = l.student_id where s.first_name = p_first and s.last_name = 'קבע' $$;

update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'אישור ההורה — הנוסח המלא, התאריכים בפועל, לא מסומן מראש:'
begin;
select t_so_enroll('רות');
select assert_true(rpc_payment_link_public(t_so_token('רות')) #>> '{standing,text}' like 'אני מאשרת חיוב של 210 ש"ח היום, ו-9 חיובים חודשיים של 110 ש"ח בתאריכים הבאים: %',
                   '★ הנוסח המדויק שביקשת, עם הסכומים של המסלול');
select assert_eq(jsonb_array_length(rpc_payment_link_public(t_so_token('רות')) #> '{standing,dates}'), 9, 'תשעה תאריכים');
select assert_true(rpc_payment_link_public(t_so_token('רות')) #>> '{standing,text}' like '%' || to_char(current_date + interval '1 month', 'DD/MM/YYYY') || '%'
                   and rpc_payment_link_public(t_so_token('רות')) #>> '{standing,text}' like '%' || to_char(current_date + interval '9 months', 'DD/MM/YYYY'),
                   '★ התאריכים בפועל: מהחודש הבא ועד התשיעי');
select assert_eq(array_length(f_standing_dates('2026-01-31', 2), 1), 2, 'f_standing_dates: מספר התאריכים');
select assert_true(f_standing_dates('2026-01-31', 1) = '{2026-02-28}', 'חודש קצר → היום האחרון שלו');
select assert_true(f_standing_consent(t_so_link('רות'), '2026-01-31') ->> 'text' like '%28/02/2026, 31/03/2026%', 'f_standing_consent: התאריכים מיום נתון');
select assert_true(rpc_standing_consent_required(t_so_token('רות')), '★ בלי אישור — checkout מסרב');
select assert_true((rpc_standing_consent(t_so_token('רות')) ->> 'required')::boolean, 'האישור נשמר');
select assert_true((select standing_consent_text like 'אני מאשרת חיוב של 210%' and standing_consented_at is not null from payment_links where id = t_so_link('רות')),
                   '★ הנוסח המדויק נשמר על הקישור, עם זמן');
select assert_true(not rpc_standing_consent_required(t_so_token('רות')) and (rpc_payment_link_public(t_so_token('רות')) #>> '{standing,consented}')::boolean, 'אחרי אישור — לא נדרש שוב, והדף מציג מה שאושר');
-- מסלול שאינו הוראת קבע: אין נוסח ואין דרישה.
select t_so_enroll('דפנה', 'card1');
select assert_true(rpc_payment_link_public(t_so_token('דפנה')) -> 'standing' = 'null'::jsonb and not rpc_standing_consent_required(t_so_token('דפנה')), 'תשלום אחד — בלי הוראת קבע');
rollback;

\echo 'יצירה אחרי החיוב הראשון, חיובים, כשלים:'
begin;
select t_so_enroll('רות');
select rpc_standing_consent(t_so_token('רות'));
select assert_eq(jsonb_array_length(rpc_standing_orders_to_setup()), 0, 'לפני תשלום — אין מה ליצור');
select rpc_record_sumit_payment((select external_identifier from payment_links where id = t_so_link('רות')), 'P-1', 210, now(), 'D-1', 'external_identifier', '777', null);
select assert_true((select status = 'active' from students where first_name = 'רות' and last_name = 'קבע'), 'החיוב הראשון → פעילה');
select assert_true((select (e ->> 'installments')::int = 9 and (e ->> 'amount')::numeric = 110 and (e ->> 'customer_id')::bigint = 777
                           and (e ->> 'date_start')::date = (current_date + interval '1 month')::date
                    from jsonb_array_elements(rpc_standing_orders_to_setup()) e), '★ ליצירה: 9 × 110 מהחודש הבא, על הלקוחה של התשלום הראשון');
select rpc_standing_order_created(t_so_link('רות'), true, 777, 5551, null);
select assert_eq(jsonb_array_length(rpc_standing_orders_to_setup()), 0, 'נוצרה — לא נוצרת שוב');
select assert_true((select status = 'active' and installments = 9 and installments_total = 10 and consent_text like 'אני מאשרת%' from standing_orders), 'ההוראה פעילה, עם הנוסח שאושר');
select assert_eq(jsonb_array_length(rpc_standing_orders_to_check()), 1, 'rpc_standing_orders_to_check: ההוראה בבדיקה');

-- חיוב חודשי תקין → תשלום ויתרה.
select rpc_record_standing_charge((select id from standing_orders), 9001, 110, now(), true, null);
select assert_true((select count(*) = 1 from payments p join students s on s.id = p.student_id where s.first_name = 'רות' and s.last_name = 'קבע' and p.amount = 110), '★ חיוב שנקלט נרשם כתשלום');
select assert_true(((rpc_record_standing_charge((select id from standing_orders), 9001, 110, now(), true, null)) ->> 'duplicate')::boolean, 'אותו חיוב פעמיים — פעם אחת');
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select charged_total = 2 and installments_total = 10 from v_standing_orders), '★ "חיוב 2 מתוך 10"');
select assert_eq((select balance::bigint from v_student_balance where student_id = (select id from students where first_name = 'רות' and last_name = 'קבע')), 880, 'היתרה: 1,200 − 210 − 110');

-- ★ חיוב שנדחה: התראה, התלמידה נשארת פעילה.
select rpc_record_standing_charge((select id from standing_orders), 9002, 110, now(), false, null);
select assert_eq((select count(*) from system_alerts where kind = 'standing_charge_declined' and created_at > now() - interval '1 minute'), 1, '★ חיוב שנדחה → התראה לבעלים באותו יום');
select assert_true((select status = 'active' from students where first_name = 'רות' and last_name = 'קבע'), '★ התלמידה לא הופכת ללא-פעילה');
select assert_true((select failed_count = 1 and charged_count = 1 from standing_orders), 'הדחייה נספרת, לא נרשם תשלום');

-- מצב מ-SUMIT: ניסיון חוזר / הושבתה → התראה, אדום במסך.
select rpc_standing_order_status((select id from standing_orders), 14, (current_date + 3), current_date);
select assert_true((select status = 'retrying' and needs_attention from v_standing_orders), 'קוד 14 → ניסיון חוזר, דורש טיפול');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_failed' and severity = 'warning'), 1, 'התראה על ניסיון חוזר');
select rpc_standing_order_status((select id from standing_orders), 3, null, current_date);
select assert_true((select status = 'failed' from standing_orders), 'קוד 3 → הושבתה');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_failed' and severity = 'critical'), 1, '★ הושבתה → התראה קריטית');
select rpc_standing_order_status((select id from standing_orders), 3, null, current_date);
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_failed'), 2, 'אותו מצב שוב — בלי התראה כפולה');
select assert_true(f_standing_status(13) = 'cancelled' and f_standing_status(9) = 'completed' and f_standing_status(0) = 'active', 'f_standing_status: מיפוי הקודים');
rollback;

\echo 'יצירה שנכשלה:'
begin;
select t_so_enroll('רות');
select rpc_standing_consent(t_so_token('רות'));
select rpc_record_sumit_payment((select external_identifier from payment_links where id = t_so_link('רות')), 'P-1', 210, now(), 'D-1', 'external_identifier', '777', null);
select rpc_standing_order_created(t_so_link('רות'), false, 777, null, 'אין כרטיס שמור');
select assert_true((select status = 'setup_failed' and last_error = 'אין כרטיס שמור' from standing_orders), 'נשמרה כ"לא נוצרה"');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_setup_failed' and severity = 'critical'), 1, '★ יצירה שנכשלה → התראה קריטית');
rollback;

\echo 'עצירה והרשאות:'
begin;
select t_so_enroll('רות');
select rpc_standing_consent(t_so_token('רות'));
select rpc_record_sumit_payment((select external_identifier from payment_links where id = t_so_link('רות')), 'P-1', 210, now(), 'D-1', 'external_identifier', '777', null);
select rpc_standing_order_created(t_so_link('רות'), true, 777, 5551, null);
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
do $$ begin
  perform rpc_standing_order_cancel_request((select id from standing_orders));
  perform assert_true(false, '★ מנהלת סניף לא עוצרת — נזרקת שגיאה');
exception when others then
  if sqlerrm like 'ASSERT%' or sqlerrm like '%✗%' then raise; end if;
  perform assert_true(true, '★ מנהלת סניף לא עוצרת — נזרקת שגיאה');
end $$;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_standing_order_cancel_request((select id from standing_orders)) ->> 'recurring_id')::bigint = 5551, 'הבעלים מקבלת את המזהים ל-SUMIT');
select assert_true((select status = 'active' from standing_orders), '★ הבקשה לבדה לא מסמנת "נעצרה" (רק אחרי ש-SUMIT ביטלה)');
reset role;
select rpc_standing_order_cancelled((select id from standing_orders), (select t_user('owner'::user_role)));
select assert_true((select status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and next_billing is null from standing_orders), 'אחרי SUMIT — נעצרה, עם מי ומתי');
-- ★ אחרי העצירה: ממשיכים לבדוק מול SUMIT. אישור ביטול (1) — שקט; עדיין פעילה שם — התראה קריטית.
select assert_eq(jsonb_array_length(rpc_standing_orders_to_check()), 1, 'הוראה שנעצרה ממשיכה להיבדק מול SUMIT');
select assert_true((rpc_standing_order_status((select id from standing_orders), 1, null, null) ->> 'confirmed_in_sumit')::boolean, 'SUMIT מאשרת: בוטלה (1)');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_cancel_mismatch'), 0, 'אישור — בלי התראה');
select rpc_standing_order_status((select id from standing_orders), 12, (current_date + 30), null);
select assert_true((select status = 'cancelled' from standing_orders), 'SUMIT עדיין פעילה — אצלנו נשארת "נעצרה"');
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_cancel_mismatch' and severity = 'critical'), 1, '★ נעצרה אצלנו ופעילה ב-SUMIT → התראה קריטית');
select rpc_standing_order_status((select id from standing_orders), 12, (current_date + 30), null);
select assert_eq((select count(*) from system_alerts where kind = 'standing_order_cancel_mismatch'), 1, 'אותה התראה לא חוזרת כל שעה');
update standing_orders set cancelled_at = now() - interval '15 days';
select assert_eq(jsonb_array_length(rpc_standing_orders_to_check()), 0, 'אחרי 14 יום — יוצאת מהבדיקה');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
do $$ begin
  perform rpc_standing_order_cancel_request((select id from standing_orders));
  perform assert_true(false, 'עצירה של הוראה שכבר נעצרה — נדחית');
exception when others then
  if sqlerrm like 'ASSERT%' or sqlerrm like '%✗%' then raise; end if;
  perform assert_true(true, 'עצירה של הוראה שכבר נעצרה — נדחית');
end $$;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from standing_orders), 1, 'מנהלת ביתר רואה את ההוראה של הסניף שלה');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
reset role;
select assert_no_table_privilege('anon', '{standing_orders,standing_order_charges}');
select assert_no_execute('authenticated', 'rpc_record_standing_charge(uuid, bigint, numeric, timestamp with time zone, boolean, text)');
select assert_no_execute('authenticated', 'rpc_standing_order_created(uuid, boolean, bigint, bigint, text)');
select assert_no_execute('authenticated', 'rpc_standing_order_cancelled(uuid, uuid)');
select assert_no_execute('anon', 'rpc_standing_consent(text)');
rollback;

update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function if exists t_so_enroll(text, text);
drop function if exists t_so_token(text);
drop function if exists t_so_link(uuid);
drop function if exists t_so_link(text);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות הוראת הקבע עברו'
