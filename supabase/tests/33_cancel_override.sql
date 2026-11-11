-- 33_cancel_override.sql — ביטול הרשמה חריג לתקנון (0051): אחרי חודש הניסיון, סכום החזר לפי הבעלים.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_co_enroll(p_first text, p_track text default 'card1') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  perform rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'חריג', 'grade', 'ה', 'school', 'בית יעקב',
    'phone', '0521115' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'co@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', p_track, 'whatsapp', 'yes', 'photo', 'yes'), '26.0.0.' || (abs(hashtext(p_first)) % 200)::text);
  v := (select id from students where first_name = p_first and last_name = 'חריג');
  -- חודש הניסיון הסתיים לפני עשרה ימים.
  update students set trial_started_on = current_date - 40 where id = v;
  return v;
end $$;
create or replace function t_co_pay(p_student uuid, p_amount numeric, p_source text default 'sumit') returns void language sql as $$
  insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
  select id, branch_id, current_date - 30, p_amount, 'credit', p_source, 'בדיקה' from students where id = p_student $$;
create or replace function t_co(p_sql text, p_role user_role default 'owner') returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return jsonb_build_object('error', sqlerrm); end;
  execute 'reset role'; return r;
end $$;

update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'אחרי חודש הניסיון:'
begin;
create temp table t_s as select t_co_enroll('שוהם') as id;
select t_co_pay((select id from t_s), 1200);
select assert_true((select status = 'active' from students where id = (select id from t_s)), 'שילמה — פעילה');
select assert_true(t_co(format('select rpc_cancel_enrollment(%L)', (select id from t_s))) ->> 'error' like 'חודש הניסיון הסתיים%',
                   'הביטול הרגיל — לפי התקנון, נדחה');
select assert_true(t_co(format('select rpc_cancel_enrollment_override(%L, 500, %L)', (select id from t_s), 'x'), 'branch_manager') ->> 'error' like 'רק הבעלים%', '★ מנהלת סניף — לא');
select assert_true(t_co(format('select rpc_cancel_enrollment_override(%L, 500, %L)', (select id from t_s), '  ')) ->> 'error' = 'יש לכתוב סיבה לביטול החריג', '★ בלי סיבה — לא');
select assert_true(t_co(format('select rpc_cancel_enrollment_override(%L, 1300, %L)', (select id from t_s), 'x')) ->> 'error' like 'סכום ההחזר (1300) גדול ממה ששולם (1200)%', '★ החזר גדול ממה ששולם — לא');
select assert_true(t_co(format('select rpc_cancel_enrollment_override(%L, -5, %L)', (select id from t_s), 'x')) ->> 'error' = 'סכום ההחזר לא יכול להיות שלילי', 'החזר שלילי — לא');
-- קישור פתוח ותזכורת מתוזמנת — יבוטלו.
insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose)
select repeat('d', 60) || 'co01', 'tl-co-1', id, branch_id, 100, 'debt' from students where id = (select id from t_s);
insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, dedupe_key)
select 'general', id, branch_id, parent_phone, 'x', 'תזכורת', now() + interval '1 day', 'co-test' from students where id = (select id from t_s);
create temp table t_r as select t_co(format('select rpc_cancel_enrollment_override(%L, 500, %L)', (select id from t_s), 'מעבר דירה')) as r;
select assert_true((select (r ->> 'ok')::boolean and (r ->> 'refund')::numeric = 500 and (r ->> 'paid_before')::numeric = 1200 and (r ->> 'from_sumit')::boolean from t_r),
                   '★ בוטל: החזר 500 מתוך 1,200, ששולמו ב-SUMIT (תזכורת להחזיר שם)');
select assert_true((select status = 'stopped' and cancelled_at is not null and refund_amount = 500 and stop_reason = 'ביטול הרשמה (חריג לתקנון): מעבר דירה'
                    from students where id = (select id from t_s)), '★ "הפסיקה", עם הסיבה והחזר');
select assert_true((select amount = -500 and source = 'refund' and method = 'credit' and note = 'החזר — ביטול הרשמה (חריג לתקנון): מעבר דירה'
                    from payments where student_id = (select id from t_s) and amount < 0), '★ שורת החזר: -500, באשראי');
select assert_true((select status = 'cancelled' from payment_links where external_identifier = 'tl-co-1'), 'קישור פתוח — בוטל');
select assert_true((select status = 'cancelled' and error = 'ההרשמה בוטלה' from reminders where dedupe_key = 'co-test'), 'תזכורת מתוזמנת — בוטלה');
select assert_true((select (after ->> 'override')::boolean and after ->> 'reason' = 'מעבר דירה' and actor = 'user:' || t_user('owner')
                    from audit_log where action = 'cancel_enrollment' and row_id = (select id from t_s)), '★ ביומן: חריג לתקנון, הסיבה, ומי');
select assert_true(t_co(format('select rpc_cancel_enrollment_override(%L, 0, %L)', (select id from t_s), 'שוב')) ->> 'error' = 'ההרשמה כבר בוטלה', 'פעמיים — לא');
-- יוצאת מרשימת החייבות.
select assert_true(t_co(format('select to_jsonb(count(*)) from v_debtors where student_id = %L', (select id from t_s))) = '0'::jsonb, '★ לא ברשימת החייבות');
rollback;

\echo 'בלי החזר:'
begin;
create temp table t_s as select t_co_enroll('רות') as id;
select t_co_pay((select id from t_s), 1200, 'manual');
select assert_true((t_co(format('select rpc_cancel_enrollment_override(%L, 0, %L)', (select id from t_s), 'לפי התקנון — בלי החזר')) ->> 'refund')::numeric = 0, 'בוטל בלי החזר');
select assert_eq((select count(*) from payments where student_id = (select id from t_s) and amount < 0), 0, '★ בלי החזר — אין שורת החזר');
select assert_true((select status = 'stopped' from students where id = (select id from t_s)), 'הפסיקה');
rollback;

\echo 'הוראת קבע פעילה:'
begin;
create temp table t_s as select t_co_enroll('אור', 'so10') as id;
create temp table t_l as select id, token, external_identifier from payment_links where student_id = (select id from t_s) and purpose = 'enrollment';
select rpc_standing_consent((select token from t_l), 20);
select rpc_record_sumit_payment((select external_identifier from t_l), 'P-CO', 210, now(), 'D-CO', 'external_identifier', '904', null);
select rpc_standing_order_created((select id from t_l), true, 904, 7781, null);
select assert_true(t_co(format('select rpc_cancel_enrollment_override(%L, 0, %L)', (select id from t_s), 'x')) ->> 'error' like 'לתלמידה יש הוראת קבע ב-SUMIT — קודם לעצור אותה%',
                   '★ הוראת קבע פעילה — קודם עוצרים אותה (אחרת ממשיכה לחייב)');
select assert_true((select status = 'active' from students where id = (select id from t_s)), '...ושום דבר לא השתנה');
rollback;

select assert_no_execute('anon', 'rpc_cancel_enrollment_override(uuid, numeric, text)');
update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function t_co_enroll(text, text); drop function t_co_pay(uuid, numeric, text); drop function t_co(text, user_role);
select drop_assert_helpers();
\echo '  ביטול הרשמה חריג לתקנון: הכל עבר'
