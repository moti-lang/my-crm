-- 28_student_discount.sql — הנחה לתלמידה (0045):
--   · שקלים או אחוזים (משכר הלימוד, עגול לשקל), עם סיבה; הבעלים בלבד.
--   · לפי השלב: החוב / קישור פתוח (המסלול מחושב מחדש, האישור מתאפס) / הוראת קבע פעילה
--     (מתחלקת שווה על החיובים שנותרו, בשקלים שלמים) / יתרת זכות.
--   · יומן: מי, מתי, מכמה לכמה, ולמה. בהוראת קבע — גם ביומן הוראות הקבע.
\set ON_ERROR_STOP on
\set SHIRA '''dddddddd-0000-0000-0000-000000000001'''
\set ESTI '''dddddddd-0000-0000-0000-000000000003'''
\set TOVI '''dddddddd-0000-0000-0000-000000000006'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

create or replace function t_dp(p_student uuid, p_kind text, p_value numeric) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select f_discount_plan(p_student, case when p_kind = 'percent' then round((select tuition_total from students where id = p_student) * p_value / 100) else p_value end, f_today_il()) $$;

\echo 'חישוב: שקלים או אחוזים, וכללים:'
begin;
select assert_true(t_dp(:ESTI, 'ils', 200) ->> 'stage' = 'none' and (t_dp(:ESTI, 'ils', 200) ->> 'balance_after')::numeric = 1800, '200 ₪ — החוב יורד ל-1,800');
select assert_true(t_dp(:ESTI, 'ils', 200) -> 'lines' ->> 0 = 'ההנחה: 200 ₪ (10.0% משכר הלימוד). שכר הלימוד: 1,800 ₪ במקום 2,000 ₪.', '★ משפט ברור: כמה, כמה אחוז, ושכר הלימוד אחרי');
select assert_true((t_dp(:ESTI, 'percent', 10) ->> 'discount_after')::numeric = 200, '10% משכר הלימוד = 200 ₪');
select assert_true((t_dp(:ESTI, 'percent', 33.3) ->> 'discount_after')::numeric = 666, 'אחוז שלא יוצא עגול — עגול לשקל (666)');
select assert_true(f_track_with_tuition('{"method": "standing_order", "installments": 8}'::jsonb, 1000, 100) @> '{"installment_amount": 125, "first_installment": 125, "first_charge": 225}'::jsonb
                   and f_track_with_tuition('{"method": "standing_order", "installments": 8}'::jsonb, 1003, 100) @> '{"installment_amount": 125, "first_installment": 128}'::jsonb
                   and f_track_with_tuition('{"method": "card_once", "installments": 1}'::jsonb, 990, 100) @> '{"first_charge": 1090}'::jsonb,
                   'f_track_with_tuition: אותו כלל כמו בהרשמה (הראשון סופג את ההפרש)');
select assert_true(not (t_dp(:ESTI, 'ils', -5) ->> 'ok')::boolean and not (t_dp(:ESTI, 'ils', 10.5) ->> 'ok')::boolean, 'שלילי / אגורות — נדחה');
select assert_true(t_dp(:ESTI, 'ils', 2500) ->> 'error' = 'ההנחה (2,500 ₪) גדולה משכר הלימוד (2,000 ₪)', '★ יותר משכר הלימוד — נדחה (דמי הרישום לא בהנחה)');
select assert_true(t_dp(:ESTI, 'ils', 0) ->> 'error' = 'זו כבר ההנחה של התלמידה', 'אותה הנחה — "זו כבר ההנחה"');
-- יתרת זכות: שילמה הכל.
select assert_true(t_dp(:SHIRA, 'ils', 300) -> 'lines' ->> 1 = 'יתרת זכות: 300 ₪ — שולם יותר מהסכום אחרי ההנחה. את ההחזר עושים ידנית ב-SUMIT.', '★ שילמה הכל — יתרת זכות, החזר ידני');
rollback;

\echo 'שמירה, יומן ודוחות:'
begin;
select assert_true(not (rpc_discount_apply(:ESTI, 200, '  ', t_user('owner'::user_role), 200) ->> 'ok')::boolean, '★ בלי סיבה — לא נשמר');
select assert_true((rpc_discount_apply(:ESTI, 200, 'אחות שנייה', t_user('owner'::user_role), 999) ->> 'changed')::boolean, '★ לא מה שהבעלים ראתה — לא נשמר ("המצב השתנה")');
select assert_true((select discount = 0 from students where id = :ESTI), '...ההנחה לא השתנתה');
select assert_true((rpc_discount_apply(:ESTI, 200, 'אחות שנייה', t_user('owner'::user_role), 200) ->> 'ok')::boolean, 'נשמרה');
select assert_true((select discount = 200 and discount_reason = 'אחות שנייה' from students where id = :ESTI), 'בכרטיס: 200 ₪, "אחות שנייה"');
select assert_true((select actor = 'user:' || t_user('owner'::user_role)::text and (before ->> 'discount')::numeric = 0 and (after ->> 'discount')::numeric = 200
                           and after ->> 'reason' = 'אחות שנייה' and after ->> 'by_name' = (select full_name from profiles where id = t_user('owner'::user_role))
                    from audit_log where action = 'discount_change' and row_id = :ESTI), '★ ביומן: מי, מכמה לכמה, ולמה');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select due = 1800 and balance = 1800 from v_student_balance where student_id = :ESTI), '★ גבייה: החוב אחרי ההנחה');
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_true((select discount = 200 from v_students_accounting where id = :ESTI), '★ דוח רואת החשבון: ההנחה');
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select changed_by = (select full_name from profiles where id = t_user('owner'::user_role)) and from_amount = 0 and to_amount = 200 and reason = 'אחות שנייה'
                    from rpc_student_discount_history(:ESTI)), '★ היסטוריית ההנחות בכרטיס');
-- עדכון ישיר / ייבוא — גם נרשם.
update students set discount = 250 where id = :ESTI;
reset role;
select assert_eq((select count(*) from audit_log where action = 'discount_change' and row_id = :ESTI), 2, '★ כל שינוי הנחה נרשם — גם עדכון ישיר');
rollback;

\echo 'קישור תשלום שעוד לא שולם — המסלול מחושב מחדש:'
create or replace function t_ds_enroll(p_first text, p_track text default 'so10') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'הנחה', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', '0521117' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'ds@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', p_track, 'whatsapp', 'yes', 'photo', 'yes', 'billing_day', '20'), '22.0.0.' || (abs(hashtext(p_first)) % 200)::text) $$;
update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';
begin;
select t_ds_enroll('לאה');
create temp table ds_t as select s.id as sid, l.id as lid, l.token from students s join payment_links l on l.student_id = s.id where s.first_name = 'לאה' and s.last_name = 'הנחה';
-- ההורה כבר אישרה ולחצה "לתשלום" (נוצר דף SUMIT) — ועדיין לא שילמה.
select rpc_standing_consent((select token from ds_t));
update payment_links set sumit_page_url = 'https://pay.sumit.co.il/x?redirectid=1' where id = (select lid from ds_t);
select assert_true((select amount = 210 from payment_links where id = (select lid from ds_t)), 'לפני: קישור 210 ₪ (100 דמי רישום + 110)');
select assert_true(t_dp((select sid from ds_t), 'percent', 10) ->> 'stage' = 'link'
                   and t_dp((select sid from ds_t), 'percent', 10) -> 'lines' ->> 1 = 'בקישור התשלום: 199 ₪ במקום 210 ₪, ואחריו 9 חיובים חודשיים של 99 ₪ במקום 110 ₪. ההורה תאשר את הסכומים החדשים כשתפתח את הקישור.',
                   '★ 10% — הקישור והחיובים החודשיים, באותו כלל כמו בהרשמה (990 = 99 + 9 × 99)');
select rpc_discount_apply((select sid from ds_t), 110, 'מלגה', t_user('owner'::user_role), 110);
select assert_true((select amount = 199 and sumit_page_url is null and sumit_redirect_id is null and standing_consented_at is null and standing_consent_text is null
                    from payment_links where id = (select lid from ds_t)), '★ הקישור: 199 ₪; דף SUMIT הישן נשכח; האישור מתאפס');
select assert_true((select (payment_track ->> 'installment_amount')::numeric = 99 and (payment_track ->> 'first_charge')::numeric = 199 from students where id = (select sid from ds_t)),
                   '★ המסלול: 199 עכשיו, 9 × 99');
select assert_true(rpc_payment_link_public((select token from ds_t)) #>> '{standing,text}' like 'אני מאשרת חיוב של 199 ש"ח היום, ו-9 חיובים חודשיים של 99 ש"ח, ב-20 בכל חודש%',
                   '★ ההורה רואה בקישור את הסכומים החדשים, לאישור מחדש');
rollback;
-- קישור יתרה ידני: יורד לחוב החדש; אין חוב — מבוטל.
begin;
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, purpose)
values ('eeeeeeee-0000-0000-0000-0000000006a1', repeat('9', 60) || '6a01', 'ds-debt', :TOVI, :BEITAR, 2000, 'debt');
select assert_true(t_dp(:TOVI, 'ils', 500) -> 'lines' ->> 1 = 'קישור התשלום הפתוח: 1,500 ₪ במקום 2,000 ₪.', 'קישור יתרה פתוח — יורד לחוב החדש');
select rpc_discount_apply(:TOVI, 500, 'בדיקה', t_user('owner'::user_role), 500);
select assert_true((select amount = 1500 from payment_links where id = 'eeeeeeee-0000-0000-0000-0000000006a1'), '...1,500 ₪');
select rpc_discount_apply(:TOVI, 2000, 'בדיקה', t_user('owner'::user_role), 2000);
select assert_true((select status = 'cancelled' from payment_links where id = 'eeeeeeee-0000-0000-0000-0000000006a1'), '★ אין יותר חוב — הקישור הפתוח מבוטל');
rollback;

\echo 'הוראת קבע פעילה — מתחלקת על החיובים שנותרו:'
begin;
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status, paid_at)
values ('eeeeeeee-0000-0000-0000-0000000006b1', repeat('8', 60) || '6b01', 'ds-so', :SHIRA, :BEITAR, 300, 'paid', now() - interval '70 days');
insert into standing_orders (id, student_id, branch_id, payment_link_id, sumit_customer_id, sumit_recurring_id, amount, installments, installments_total,
                             date_start, consent_text, consented_at, status, next_billing, last_billing, charged_count, billing_day)
values ('eeeeeeee-0000-0000-0000-0000000006c1', :SHIRA, :BEITAR, 'eeeeeeee-0000-0000-0000-0000000006b1', 77, 9601, 100, 9, 10,
        f_today_il() - interval '60 days', 'אישור', now() - interval '70 days', 'active', f_today_il() + 10, f_today_il() - 20, 2, 5);
-- 140 ₪ על 7 חיובים = 20 ₪ לחיוב, בדיוק.
select assert_true(t_dp(:SHIRA, 'ils', 140) ->> 'stage' = 'standing' and (t_dp(:SHIRA, 'ils', 140) #>> '{standing,to_monthly}')::numeric = 80
                   and t_dp(:SHIRA, 'ils', 140) -> 'lines' ->> 1 = format('בהוראת הקבע: 7 חיובים של 80 ₪ במקום 100 ₪, החל מ-%s.', to_char(f_today_il() + 10, 'DD/MM')),
                   '★ 140 ₪ על 7 החיובים שנותרו: 7 × 80 במקום 7 × 100');
-- 100 ₪ על 7 = 14.28 — חיובים שווים בשקלים: 14 × 7 = 98.
select assert_true((t_dp(:SHIRA, 'ils', 100) ->> 'discount_after')::numeric = 98
                   and t_dp(:SHIRA, 'ils', 100) -> 'lines' ->> 2 = 'החיובים בהוראת קבע שווים, ולכן ההנחה בפועל 98 ₪ (14 ₪ × 7) ולא 100 ₪.',
                   '★ לא מתחלק בשלמים — ההנחה בפועל מוצגת (98 ולא 100)');
select assert_true(t_dp(:SHIRA, 'ils', 3) ->> 'error' like 'ההנחה (3 ₪) קטנה מדי לחלוקה על 7 החיובים שנותרו%', 'פחות משקל לחיוב — נדחה');
select assert_true(t_dp(:SHIRA, 'ils', 1000) ->> 'error' like 'ההנחה גדולה מהחיובים שנותרו בהוראת הקבע%', 'יותר מהחיובים שנותרו — נדחה');
select assert_true((rpc_discount_apply(:SHIRA, 140, 'מלגה', t_user('owner'::user_role), 140, 80) ->> 'ok')::boolean, 'נשמרה (אחרי ש-SUMIT עדכנה ל-80)');
select assert_true((select amount = 80 from standing_orders where id = 'eeeeeeee-0000-0000-0000-0000000006c1')
                   and (select discount = 140 from students where id = :SHIRA), '★ הוראת הקבע: 80 ₪; ההנחה: 140 ₪');
select assert_true((select kind = 'amount_change' and from_amount = 100 and to_amount = 80 and remaining = 7 and actor = t_user('owner'::user_role)
                    from standing_order_events where standing_order_id = 'eeeeeeee-0000-0000-0000-0000000006c1'), '★ ביומן הוראות הקבע: 100 ← 80, מי');
-- ★ הקטנת הנחה (העלאת סכום) — לא בהוראה פעילה.
select assert_true(t_dp(:SHIRA, 'ils', 70) ->> 'error' like 'אי אפשר להקטין או לבטל הנחה כשיש הוראת קבע פעילה%', '★ הקטנת הנחה בהוראה פעילה — נדחה (ההורה אישרה סכום נמוך)');
-- ★ חיוב היום / ניסיון חוזר — לא עכשיו.
update standing_orders set next_billing = f_today_il() where id = 'eeeeeeee-0000-0000-0000-0000000006c1';
select assert_true(t_dp(:SHIRA, 'ils', 280) ->> 'error' like 'החיוב שתוכנן ל-%עוד לא נקלט%', '★ חיוב מתוכנן להיום — לא משנים סכום');
update standing_orders set next_billing = f_today_il() + 10, status = 'retrying' where id = 'eeeeeeee-0000-0000-0000-0000000006c1';
select assert_true(t_dp(:SHIRA, 'ils', 280) ->> 'error' like 'יש חיוב שנדחה%', 'ניסיון חוזר — לא עכשיו');
-- בהוראה: SUMIT קיבלה סכום אחר ממה שהתוכנית — לא נשמר.
update standing_orders set status = 'active' where id = 'eeeeeeee-0000-0000-0000-0000000006c1';
select assert_true((rpc_discount_apply(:SHIRA, 280, 'x', t_user('owner'::user_role), 280, 79) ->> 'changed')::boolean, 'סכום חודשי אחר מהתוכנית — לא נשמר');
rollback;
-- הוראת קבע בתהליך יצירה (שולם, עוד לא נוצרה) — לא עכשיו.
begin;
select t_ds_enroll('רבקה');
select rpc_standing_consent((select l.token from payment_links l join students s on s.id = l.student_id where s.first_name = 'רבקה' and s.last_name = 'הנחה'));
update payment_links set status = 'paid', paid_at = now() where student_id = (select id from students where first_name = 'רבקה' and last_name = 'הנחה');
insert into payments (student_id, branch_id, paid_on, amount, method, source) select id, branch_id, current_date, 210, 'credit', 'sumit' from students where first_name = 'רבקה' and last_name = 'הנחה';
select assert_true(t_dp((select id from students where first_name = 'רבקה' and last_name = 'הנחה'), 'ils', 100) ->> 'error' like 'הוראת הקבע של התלמידה בתהליך יצירה%', 'הוראה בתהליך יצירה — לא עכשיו');
rollback;
update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';

\echo 'הרשאות:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_discount_preview(:ESTI, 'percent', 10) ->> 'amount')::numeric = 200, 'הבעלים: תצוגה (10% = 200 ₪)');
do $$ declare r text; begin
  foreach r in array array['branch_manager', 'accountant'] loop
    begin
      perform set_config('request.jwt.claims', t_claims(r::user_role), true);
      perform rpc_discount_preview('dddddddd-0000-0000-0000-000000000003', 'ils', 100);
      perform assert_true(false, format('★ %s לא נותנת הנחה', r));
    exception when others then
      if sqlerrm like '%✗%' then raise; end if;
      perform assert_true(sqlstate = '42501', format('★ %s לא נותנת הנחה', r));
    end;
  end loop;
end $$;
reset role;
select assert_no_execute('anon', 'rpc_discount_preview(uuid, text, numeric)');
select assert_no_execute('authenticated', 'rpc_discount_apply(uuid, numeric, text, uuid, numeric, numeric)');
select assert_no_execute('authenticated', 'f_discount_plan(uuid, numeric, date)');
select assert_no_execute('anon', 'rpc_student_discount_history(uuid)');
rollback;

drop function if exists t_dp(uuid, text, numeric);
drop function if exists t_ds_enroll(text, text);
\echo '  הנחה לתלמידה: הכל עבר'
