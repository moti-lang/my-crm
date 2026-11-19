-- 36_discount_track.sql — הנחה בלי קישור פתוח מעדכנת את סכומי המסלול, ו"קישור הרשמה חדש" לפי ההנחה (0059).
--   המקרה (16/11): אושרת ראובן — הנחה 100 ₪ כשהיה לה רק קישור חוב; הקישור החדש יצא 280 + 9×180 (1,900)
--   במקום 270 + 9×170 (1,800). מנוחי ביר — אותו דבר כשהקישור שלה פג.
\set ON_ERROR_STOP on
\ir _assert.sql

create or replace function t_dt_add(p_first text, p_status text default 'active') returns uuid language plpgsql as $$
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  perform rpc_create_student(jsonb_build_object('branch_id', 'bbbbbbbb-0000-0000-0000-000000000001', 'first_name', p_first, 'last_name', 'הנחהמסלול',
         'parent_phone', '05211' || lpad((abs(hashtext(p_first)) % 100000)::text, 5, '0'), 'status', p_status, 'track', 'so10'));
  execute 'reset role';
  return (select id from students where first_name = p_first and last_name = 'הנחהמסלול');
end $$;
create or replace function t_dt(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', t_claims('owner'), true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then execute 'reset role'; return 'ERROR: ' || sqlerrm; end;
  execute 'reset role'; return coalesce(r, 'null');
end $$;
create or replace function t_dt_track(p_id uuid) returns text language sql security definer set search_path = public, pg_temp as $$
  select (payment_track ->> 'first_charge')::numeric::int || '+' || (payment_track ->> 'installment_amount')::numeric::int from students where id = p_id $$;

update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'הנחה כשאין קישור הרשמה פתוח (אושרת):'
begin;
create temp table t_s as select t_dt_add('אושרת') as id;
grant select on t_s to authenticated;
-- המסלול לפני ההנחה (שכר לימוד ודמי רישום לפי הסניף בבדיקה).
create temp table t_before as select t_dt_track((select id from t_s)) as tr,
  (select (payment_track ->> 'first_charge')::numeric from students where id = (select id from t_s)) as fc,
  (select (payment_track ->> 'installment_amount')::numeric from students where id = (select id from t_s)) as ia;
-- כמו שקרה: קודם נשלח קישור תשלום רגיל (חוב), אחר כך הנחה של 100.
insert into payment_links (token, external_identifier, student_id, branch_id, amount, purpose, status)
select repeat('d', 60) || 'dt01', 'tl-dt-debt', id, branch_id, tuition_total, 'debt', 'opened' from students where id = (select id from t_s);
select assert_true(t_dt('select rpc_discount_preview((select id from t_s), ''ils'', 90)::text')::jsonb ->> 'lines' like '%בקישור הבא:%',
                   '★ התצוגה לפני השמירה: הסכומים של הקישור הבא אחרי ההנחה');
select rpc_discount_apply((select id from t_s), 90, 'מלגה', t_user('owner'::user_role), 90);
select assert_true(t_dt_track((select id from t_s)) = ((select fc from t_before) - 9)::int || '+' || ((select ia from t_before) - 9)::int,
                   '★ ההנחה (90 ₪ — 9 לכל אחד מ-10 החיובים) עדכנה את המסלול גם בלי קישור הרשמה פתוח');
-- הסכום הכולל אחרי ההנחה = החוב.
select assert_true((select (payment_track ->> 'first_charge')::numeric + 9 * (payment_track ->> 'installment_amount')::numeric
                            = tuition_total - discount + registration_fee from students where id = (select id from t_s)),
                   '★ תשלום ראשון + 9 חודשיים = החוב אחרי ההנחה');
create temp table t_r as select t_dt('select rpc_renew_enrollment_link((select id from t_s))::text')::jsonb as r;
select assert_true((select (r ->> 'amount')::numeric from t_r) = (select (payment_track ->> 'first_charge')::numeric from students where id = (select id from t_s)),
                   '★ קישור הרשמה חדש — בסכום שאחרי ההנחה');
select assert_true((select f_standing_consent(l.id, null, 11) ->> 'text' like format('%%ו-9 חיובים חודשיים של %s ש"ח%%', (select ia from t_before)::int - 9)
                      from payment_links l where l.student_id = (select id from t_s) and l.purpose = 'enrollment' and l.status = 'pending'),
                   '★ נוסח האישור בדף ההורה — החודשי שאחרי ההנחה');
rollback;

\echo 'מסלול ישן (ההנחה ניתנה לפני התיקון) — הקישור החדש מחשב מחדש (מנוחי):'
begin;
create temp table t_s as select t_dt_add('מנוחי', 'pending') as id;
grant select on t_s to authenticated;
create temp table t_before as select (payment_track ->> 'first_charge')::numeric as fc from students where id = (select id from t_s);
-- כמו לפני 0059: ההנחה נשמרה בלי לגעת במסלול.
update students set discount = 100 where id = (select id from t_s);
update payment_links set status = 'expired' where student_id = (select id from t_s);
create temp table t_r as select t_dt('select rpc_renew_enrollment_link((select id from t_s))::text')::jsonb as r;
select assert_true((select (r ->> 'amount')::numeric from t_r) < (select fc from t_before), '★ הקישור החדש — אחרי ההנחה, לא הסכום הישן מהמסלול');
select assert_true((select (payment_track ->> 'first_charge')::numeric + 9 * (payment_track ->> 'installment_amount')::numeric
                            = tuition_total - discount + registration_fee from students where id = (select id from t_s)),
                   '★ ...והמסלול נשמר מתוקן: תשלום ראשון + 9 חודשיים = החוב');
rollback;

\echo 'מה שלא משתנה:'
begin;
create temp table t_s as select t_dt_add('שילמה') as id;
create temp table t_before as select t_dt_track((select id from t_s)) as tr;
insert into payments (student_id, branch_id, paid_on, amount, method, source, note)
select id, branch_id, current_date, 50, 'cash', 'manual', 'בדיקה' from students where id = (select id from t_s);
select rpc_discount_apply((select id from t_s), 90, 'מלגה', t_user('owner'::user_role), 90);
select assert_true(t_dt_track((select id from t_s)) = (select tr from t_before), 'שולם משהו — המסלול לא מחושב מחדש (כמו קודם)');
rollback;

update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function t_dt_add(text, text); drop function t_dt(text); drop function t_dt_track(uuid);
select drop_assert_helpers();
\echo '  הנחה ומסלול: הכל עבר'
