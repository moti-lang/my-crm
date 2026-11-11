-- 32_payment_void.sql — ביטול תשלום (0050): "נרשם בטעות" / "הוחזר להורה", והחוב חוזר כאילו לא שולם.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN '''bbbbbbbb-0000-0000-0000-000000000002'''
\set ESTI '''dddddddd-0000-0000-0000-000000000003'''
\ir _assert.sql

create or replace function t_pv_pay(p_student uuid, p_amount numeric, p_source text default 'manual') returns uuid language sql as $$
  insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
  select id, branch_id, current_date - 3, p_amount, 'credit', p_source, 'בדיקה' from students where id = p_student returning id $$;
-- כמשתמשת: מחזירה את התוצאה, או את הודעת השגיאה.
create or replace function t_pv_void(p_payment uuid, p_kind text, p_reason text, p_role user_role default 'owner') returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin r := rpc_void_payment(p_payment, p_kind, p_reason);
  exception when others then execute 'reset role'; return jsonb_build_object('error', sqlerrm); end;
  execute 'reset role'; return r;
end $$;
create or replace function t_pv_balance(p_student uuid) returns numeric language sql as $$
  select (s.tuition_total - s.discount) - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0) from students s where s.id = p_student $$;
create or replace function t_pv_history(p_student uuid, p_role user_role default 'owner') returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  select string_agg(kind || ':' || amount || ':' || coalesce(reason, '') || ':' || coalesce(by_name, ''), ',' order by at) into v from rpc_payment_void_history(p_student);
  execute 'reset role'; return v;
end $$;

\echo 'נרשם בטעות:'
begin;
create temp table t_p as select t_pv_pay(:ESTI, 500) as id;
create temp table t_b as select t_pv_balance(:ESTI) as before;
select assert_true(t_pv_void((select id from t_p), 'mistake', 'הוקלד פעמיים') ->> 'ok' = 'true', 'הבעלים מבטלת');
select assert_true((select deleted_at is not null and void_reason = 'הוקלד פעמיים' and voided_by = t_user('owner') from payments where id = (select id from t_p)),
                   '★ התשלום נמחק (נשאר בטבלה, עם הסיבה ומי)');
select assert_true(t_pv_balance(:ESTI) = (select before from t_b) + 500, '★ החוב חזר — כאילו לא שולם (+500)');
select assert_true(t_pv_history(:ESTI) = 'mistake:500.00:הוקלד פעמיים:' || (select full_name from profiles where id = t_user('owner')),
                   '★ בהיסטוריה: נרשם בטעות, כמה, למה, ומי');
select assert_true(t_pv_void((select id from t_p), 'refund', 'שוב') ->> 'error' like 'התשלום לא נמצא, או שכבר בוטל%', 'תשלום שכבר נמחק — אין מה לבטל שוב');
select assert_true(f_payment_voided((select id from t_p)) and not f_payment_voided(null), 'f_payment_voided: נמחק — כן; בלי תשלום — לא');
rollback;

\echo 'הוחזר להורה:'
begin;
create temp table t_p as select t_pv_pay(:ESTI, 500) as id;
create temp table t_b as select t_pv_balance(:ESTI) as before;
create temp table t_r as select t_pv_void((select id from t_p), 'refund', 'כפל תשלום') as r;
select assert_true((select (r ->> 'amount')::numeric = 500 and r ->> 'kind' = 'refund' and not (r ->> 'from_sumit')::boolean from t_r), 'נרשם');
select assert_true((select amount = -500 and source = 'refund' and refund_of = (select id from t_p) and deleted_at is null and note like 'החזר על תשלום מ-%: כפל תשלום'
                    from payments where id = (select (r ->> 'refund_id')::uuid from t_r)), '★ שורת החזר: -500, מקושרת לתשלום, עם הסיבה');
select assert_true((select deleted_at is null from payments where id = (select id from t_p)), '★ התשלום המקורי נשאר בהיסטוריה');
select assert_true(t_pv_balance(:ESTI) = (select before from t_b) + 500, '★ החוב חזר (+500)');
select assert_true(t_pv_void((select id from t_p), 'refund', 'שוב') ->> 'error' = 'על התשלום הזה כבר נרשם החזר', '★ החזר שני על אותו תשלום — נדחה');
select assert_true(t_pv_void((select (r ->> 'refund_id')::uuid from t_r), 'mistake', 'x') ->> 'error' like 'זו שורת החזר%', 'את שורת ההחזר עצמה — לא מבטלים כאן');
select assert_true(t_pv_history(:ESTI) like 'refund:500.00:כפל תשלום:%', '★ בהיסטוריה: הוחזר להורה');
rollback;

\echo 'הדוחות:'
begin;
create temp table t_p as select t_pv_pay(:ESTI, 500) as id;
-- הדוח לפי התפקיד של הקוראת — כבעלים.
create or replace function t_pv_income() returns numeric language plpgsql as $$
declare v numeric;
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  select income_students into v from v_branch_pnl where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  execute 'reset role'; return v;
end $$;
create temp table t_i as select t_pv_income() as before;
select assert_true((select before from t_i) is not null, 'הדוח נקרא כבעלים');
select t_pv_void((select id from t_p), 'refund', 'החזר');
select assert_true(t_pv_income() = (select before from t_i) - 500, '★ ההכנסות בדוחות יורדות בהחזר');
rollback;

\echo 'כללים והרשאות:'
begin;
create temp table t_p as select t_pv_pay(:ESTI, 500, 'sumit') as id;
select assert_true(t_pv_void((select id from t_p), 'mistake', '  ') ->> 'error' = 'יש לכתוב סיבה לביטול', '★ בלי סיבה — לא');
select assert_true(t_pv_void((select id from t_p), 'delete', 'x') ->> 'error' = 'סוג ביטול לא מוכר', 'סוג לא מוכר — לא');
select assert_true(t_pv_void((select id from t_p), 'mistake', 'x', 'branch_manager') ->> 'error' like 'רק הבעלים%', '★ מנהלת סניף — לא');
select assert_true(t_pv_void((select id from t_p), 'mistake', 'x', 'accountant') ->> 'error' like 'רק הבעלים%', '★ רואת חשבון — לא');
select assert_true((t_pv_void((select id from t_p), 'refund', 'הוחזר ב-SUMIT') ->> 'from_sumit')::boolean, '★ תשלום מ-SUMIT — תזכורת להחזיר שם');
select assert_true(t_pv_history(:ESTI, 'accountant') like 'refund:%', 'רואת חשבון רואה את ההיסטוריה');
select assert_true(t_pv_history(:ESTI, 'branch_manager') like 'refund:%', 'מנהלת הסניף רואה');
update students set branch_id = :MODIIN where id = :ESTI;
select assert_true(t_pv_history(:ESTI, 'branch_manager') is null, '★ מנהלת סניף אחר — לא רואה');
rollback;
select assert_no_execute('anon', 'rpc_void_payment(uuid, text, text)');
select assert_no_execute('authenticated', 'f_payment_voided(uuid)');
select assert_no_execute('authenticated', 'f_enrollment_link_paid(uuid)');

\echo 'כאילו לא שולם — חזרה ל"ממתינה":'
update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';
create or replace function t_pv_enroll(p_first text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'ביטול', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', '0521116' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'pv@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', 'so10', 'whatsapp', 'yes', 'photo', 'yes', 'billing_day', '20'), '25.0.0.' || (abs(hashtext(p_first)) % 200)::text);
  return (select id from students where first_name = p_first and last_name = 'ביטול');
end $$;
begin;
-- שילמה הכל ברישום ידני (כמו אדל לוגסי) → פעילה; ההחזר → ממתינה, ואפשר שוב "קישור הרשמה חדש".
create temp table t_s as select t_pv_enroll('אדל') as id;
create temp table t_p as select t_pv_pay((select id from t_s), 2100) as id;
select assert_true((select status = 'active' from students where id = (select id from t_s)), 'שילמה 2,100 — פעילה');
select assert_true((t_pv_void((select id from t_p), 'refund', 'ביטלה את ההרשמה') ->> 'pending')::boolean, 'ההחזר מדווח: חזרה ל"ממתינה"');
select assert_true((select status = 'pending' from students where id = (select id from t_s)), '★ "ממתינה" — כאילו לא שילמה');
select assert_true((select f_enrollment_unpaid(s) from students s where s.id = (select id from t_s)), '★ ...ושוב ממתינה לחיוב הראשון ("קישור הרשמה חדש" מותר)');
rollback;
begin;
-- שילמה בקישור ההרשמה (SUMIT) והתשלום בוטל → הקישור כבר לא נחשב "שולם".
create temp table t_s as select t_pv_enroll('נגה') as id;
create temp table t_l as select id, token, external_identifier from payment_links where student_id = (select id from t_s) and purpose = 'enrollment';
select rpc_standing_consent((select token from t_l), 20);
select rpc_record_sumit_payment((select external_identifier from t_l), 'P-PV', 210, now(), 'D-PV', 'external_identifier', '903', null);
select assert_true(f_enrollment_link_paid((select id from t_s)), 'קישור ההרשמה שולם');
select assert_true((t_pv_void((select payment_id from payment_links where id = (select id from t_l)), 'refund', 'החזר ב-SUMIT') ->> 'pending')::boolean, 'החזר → ממתינה');
select assert_true(not f_enrollment_link_paid((select id from t_s)), '★ קישור ששולם בתשלום שהוחזר — כבר לא "שולם"');
select assert_true((select f_enrollment_unpaid(s) from students s where s.id = (select id from t_s)), '...ממתינה לחיוב הראשון');
-- ★ אבל אם כבר נוצרה הוראת קבע ב-SUMIT — אין קישור חדש (הוראה שנייה).
select rpc_standing_order_created((select id from t_l), true, 903, 7771, null);
create or replace function t_pv_renew_error(p_student uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  begin perform rpc_renew_enrollment_link(p_student); exception when others then execute 'reset role'; return sqlerrm; end;
  execute 'reset role'; return null;
end $$;
select assert_true(t_pv_renew_error((select id from t_s)) like 'לתלמידה יש הוראת קבע ב-SUMIT%', '★ יש הוראת קבע — "קישור הרשמה חדש" נדחה (היה יוצר הוראה שנייה)');
rollback;
begin;
-- תלמידה שנוספה ידנית כפעילה — ביטול תשלום לא מחזיר אותה ל"ממתינה".
create temp table t_p as select t_pv_pay(:ESTI, 500) as id;
select assert_true(not (t_pv_void((select id from t_p), 'mistake', 'x') ->> 'pending')::boolean and (select status = 'active' from students where id = :ESTI),
                   'תלמידה שלא נרשמה דרך ההרשמה — נשארת פעילה');
rollback;
update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';

drop function t_pv_pay(uuid, numeric, text); drop function t_pv_void(uuid, text, text, user_role); drop function t_pv_balance(uuid);
drop function t_pv_history(uuid, user_role); drop function t_pv_enroll(text);
select drop_assert_helpers();
\echo '  ביטול תשלום: הכל עבר'
