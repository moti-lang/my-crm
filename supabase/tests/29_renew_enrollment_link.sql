-- 29_renew_enrollment_link.sql — קישור הרשמה חדש (0046) וסכום חלקי בקישור תשלום.
--   המקרה (גלוברמן, 8/11): הכרטיס לא עבר בדף של SUMIT, הקישור פג. "קישור תשלום" רגיל היה
--   גובה את החיוב הראשון בלי הוראת קבע ובלי להשלים את ההרשמה.
--   · קישור הרשמה חדש: כמו בהרשמה — אותו מסלול, אותו סכום, יום החיוב שנבחר, אישור הוראת הקבע;
--     אחרי התשלום התלמידה פעילה וההוראה מוכנה ליצירה. הקודם מתבטל. ביומן.
--   · קישור תשלום רגיל לתלמידה כזו — נדחה עם הפניה.
--   · סכום חלקי: לפחות 1 ₪, לא יותר מהחוב.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN '''bbbbbbbb-0000-0000-0000-000000000002'''
\ir _assert.sql

create or replace function t_rn_enroll(p_first text, p_track text default 'so10', p_day text default '20') returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select rpc_enroll(jsonb_build_object('first_name', p_first, 'last_name', 'חידוש', 'grade', 'ד', 'school', 'בית יעקב',
    'phone', '0521119' || lpad((abs(hashtext(p_first)) % 1000)::text, 3, '0'), 'email', 'rn@example.com',
    'enroll_token', (select enroll_token from branches where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
    'terms_accepted', true, 'track', p_track, 'whatsapp', 'yes', 'photo', 'yes', 'billing_day', p_day), '22.0.0.' || (abs(hashtext(p_first)) % 200)::text) $$;
create or replace function t_rn_student(p_first text) returns uuid language sql security definer set search_path = public, pg_temp as $$
  select id from students where first_name = p_first and last_name = 'חידוש' $$;
create or replace function t_rn_live(p_first text) returns payment_links language sql security definer set search_path = public, pg_temp as $$
  select l from payment_links l where l.student_id = t_rn_student(p_first) and l.status in ('pending', 'opened') order by created_at desc limit 1 $$;
-- כמשתמשת (authenticated + claims), וחזרה לבעל המסד לפני ההחזרה.
create or replace function t_rn_renew(p_first text, p_role user_role default 'owner') returns jsonb language plpgsql as $$
declare v_student uuid := t_rn_student(p_first); r jsonb;
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  r := rpc_renew_enrollment_link(v_student);
  execute 'reset role';
  return r;
end $$;
-- הודעת שגיאה של פעולה שנדחתה (בלי לעצור את הקובץ).
create or replace function t_rn_error(p_sql text, p_role user_role default 'owner') returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', t_claims(p_role), true);
  execute 'set local role authenticated';
  begin execute p_sql; exception when others then execute 'reset role'; return sqlerrm; end;
  execute 'reset role'; return null;
end $$;

update settings set value = 'true'::jsonb where key = 'standing_orders_enabled';

\echo 'הכרטיס לא עבר והקישור פג — קישור הרשמה חדש:'
begin;
select assert_true((t_rn_enroll('תמר') ->> 'ok')::boolean, 'נרשמה להוראת קבע, 10 תשלומים, יום 20');
-- הדף של SUMIT נפתח, הכרטיס לא עבר, והקישור פג.
update payment_links set status = 'opened', opened_at = now() - interval '8 days', sumit_page_url = 'https://pay.sumit.co.il/x',
                         expires_at = now() - interval '1 day' where student_id = t_rn_student('תמר');
create temp table t_old as select id from payment_links where student_id = t_rn_student('תמר');
grant select on t_old to authenticated;

select assert_true((select f_enrollment_unpaid(s) from students s where s.id = t_rn_student('תמר')), 'f_enrollment_unpaid: ממתינה, הוראת קבע, לא שולם — כן');
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L)', t_rn_student('תמר'))) like '%קישור הרשמה חדש%',
                   '★ "קישור תשלום" רגיל — נדחה, עם הפניה לקישור הרשמה חדש');
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L, 100)', t_rn_student('תמר'))) like '%קישור הרשמה חדש%', '...גם בסכום חלקי');
select assert_eq((select count(*) from payment_links where student_id = t_rn_student('תמר')), 1, '...ושום קישור חוב לא נוצר');

create temp table t_r (r jsonb);
insert into t_r select t_rn_renew('תמר');
select assert_true((select (r ->> 'amount')::numeric = 210 and (r ->> 'standing')::boolean and r ->> 'url' like '%/pay/%' from t_r),
                   '★ קישור חדש: החיוב הראשון של המסלול (210 ₪), הוראת קבע');
select assert_true((select l.purpose = 'enrollment' and l.status = 'pending' and l.amount = 210 and l.expires_at > now() + interval '6 days'
                     and l.sumit_page_url is null and l.standing_consented_at is null and l.created_by = t_user('owner')
                    from payment_links l where l.id = (select (r ->> 'id')::uuid from t_r)),
                   '★ קישור הרשמה (לא חוב), 7 ימים, בלי דף SUMIT ישן ובלי אישור ישן');
select assert_eq((select count(*) from payment_links where student_id = t_rn_student('תמר') and status in ('pending', 'opened') and expires_at > now()), 1, 'קישור חי אחד');
select assert_true((select body like 'שלום %, זה קישור חדש להשלמת ההרשמה של תמר%' and body like '%/pay/%' and body like '%התשלום הראשון: 210 ₪.%'
                     and body like '%בוחרים את יום החיוב בחודש ומאשרים את הוראת הקבע (עוד 9 תשלומים)%' and body like '%7 ימים%'
                    from reminders where dedupe_key = 'payment_link:' || (select r ->> 'id' from t_r)),
                   '★ הודעת וואטסאפ להורה: קישור חדש, הסכום, ושבדף בוחרים יום ומאשרים את הוראת הקבע');
select assert_true((select actor = 'user:' || t_user('owner') and after ->> 'amount' = '210' and after ->> 'track' = 'so10'
                    from audit_log where action = 'renew_enrollment_link' and row_id = t_rn_student('תמר')), '★ ביומן: מי שלחה, הסכום והמסלול');

-- הדף: אותו מסלול, יום החיוב שנבחר בהרשמה, אישור הוראת הקבע.
select assert_true(rpc_payment_link_public((select r ->> 'token' from t_r)) #>> '{standing,text}'
                   like 'אני מאשרת חיוב של 210 ש"ח היום, ו-9 חיובים חודשיים של 110 ש"ח, ב-20 בכל חודש%', '★ בדף: אישור הוראת הקבע, ביום שנבחר (20)');
select assert_true((rpc_payment_link_public((select token from payment_links where id = (select id from t_old))) ->> 'ok')::boolean = false, 'הקישור הישן לא נפתח');
-- אישור + תשלום → פעילה, וההוראה מוכנה ליצירה ב-SUMIT.
select rpc_standing_consent((select r ->> 'token' from t_r), 20);
select rpc_record_sumit_payment((select external_identifier from payment_links where id = (select (r ->> 'id')::uuid from t_r)), 'P-RN', 210, now(), 'D-RN', 'external_identifier', '889', null);
select assert_true((select status = 'active' from students where id = t_rn_student('תמר')), '★ אחרי התשלום — ההרשמה הושלמה (פעילה)');
select assert_true((select not f_enrollment_unpaid(s) from students s where s.id = t_rn_student('תמר')), 'f_enrollment_unpaid: אחרי התשלום — לא');
select assert_true(exists (select 1 from jsonb_array_elements(rpc_standing_orders_to_setup()) e
                           where e ->> 'link_id' = (select r ->> 'id' from t_r) and (e ->> 'installments')::int = 9 and (e ->> 'amount')::numeric = 110),
                   '★ ...והוראת הקבע מוכנה ליצירה: 9 חיובים של 110 ₪');
select assert_true(t_rn_error(format('select rpc_renew_enrollment_link(%L)', t_rn_student('תמר'))) like '%כבר שולם%', 'שולם — אין קישור הרשמה נוסף');
rollback;

\echo 'כללים:'
begin;
select t_rn_enroll('רות'), t_rn_enroll('שני', 'card1'), t_rn_enroll('לאה', 'cash');
-- שני קישורים ברצף: רק האחרון חי.
select t_rn_renew('רות');
select t_rn_renew('רות');
select assert_eq((select count(*) from payment_links where student_id = t_rn_student('רות') and status in ('pending', 'opened')), 1, 'שוב ושוב — קישור חי אחד');
-- תשלום אחד בכרטיס: אותו דבר, בלי הוראת קבע.
select assert_true((select (r ->> 'amount')::numeric = 1200 and not (r ->> 'standing')::boolean from (select t_rn_renew('שני') r) x), 'תשלום אחד בכרטיס: 1,200 ₪, בלי הוראת קבע');
reset role;
select assert_true((select body not like '%הוראת הקבע%' from reminders where student_id = t_rn_student('שני') and body like '%קישור חדש%'), '...וההודעה בלי משפט על הוראת קבע');
-- מזומן: אין חיוב ראשון בכרטיס.
select assert_true(t_rn_error(format('select rpc_renew_enrollment_link(%L)', t_rn_student('לאה'))) like '%לא במזומן%', '★ מסלול מזומן — נדחה');
-- פעילה (לא ממתינה).
update students set status = 'active' where id = t_rn_student('שני');
select assert_true(t_rn_error(format('select rpc_renew_enrollment_link(%L)', t_rn_student('שני'))) like '%ממתינה%', '★ תלמידה פעילה — נדחה');
-- בלי טלפון.
update students set parent_phone = null where id = t_rn_student('רות');
select assert_true(t_rn_error(format('select rpc_renew_enrollment_link(%L)', t_rn_student('רות'))) like '%טלפון%', 'בלי טלפון של הורה — נדחה');
rollback;

\echo 'הרשאות:'
begin;
select t_rn_enroll('נועה');
select assert_true((select (t_rn_renew('נועה', 'branch_manager') ->> 'amount')::numeric = 210), 'מנהלת הסניף — שולחת');
select assert_true(t_rn_error(format('select rpc_renew_enrollment_link(%L)', t_rn_student('נועה')), 'accountant') like '%אין הרשאה%', '★ רואת חשבון — לא');
update students set branch_id = :MODIIN where id = t_rn_student('נועה');
select assert_true(t_rn_error(format('select rpc_renew_enrollment_link(%L)', t_rn_student('נועה')), 'branch_manager') like '%אין הרשאה%', '★ מנהלת סניף אחר — לא');
rollback;
select assert_no_execute('anon', 'rpc_renew_enrollment_link(uuid)');
select assert_no_execute('anon', 'f_enrollment_unpaid(students)');
select assert_no_execute('authenticated', 'f_enrollment_unpaid(students)');

\echo 'סכום חלקי בקישור תשלום (100 ₪ בכרטיס, השאר במזומן):'
begin;
create temp table t_d as
  -- ישירות מהטבלאות (התצוגה מסננת לפי התפקיד של הקוראת), כמו ב-16.
  select s.id from students s
  where s.branch_id = :BEITAR and s.status = 'active' and s.deleted_at is null and s.parent_phone is not null
    and (s.tuition_total - s.discount) - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0) > 150
  order by s.id limit 1;
select assert_eq((select count(*) from t_d), 1, 'יש חייבת לבדיקה');
grant select on t_d to authenticated;
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L, 100)', (select id from t_d))) is null, '★ 100 ₪ מתוך החוב — נוצר');
select assert_true((select amount = 100 from payment_links where student_id = (select id from t_d) and status = 'pending'), '...הקישור על 100 ₪');
select assert_true((select body like '%הסכום: 100.00 ₪%' from reminders where student_id = (select id from t_d) and kind = 'payment_link' order by created_at desc limit 1), '...וכך בהודעה');
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L, 0.5)', (select id from t_d))) like '%לפחות 1%', '★ פחות מ-1 ₪ — נדחה');
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L, -5)', (select id from t_d))) like '%לפחות 1%', 'סכום שלילי — נדחה');
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L, 99999999)', (select id from t_d))) like '%גדול מהחוב%', '★ יותר מהחוב — נדחה');
select assert_true(t_rn_error(format('select rpc_create_payment_link(%L)', (select id from t_d))) is null, 'בלי סכום — כל החוב, כמו קודם');
rollback;

update settings set value = 'false'::jsonb where key = 'standing_orders_enabled';
drop function t_rn_enroll(text, text, text); drop function t_rn_renew(text, user_role); drop function t_rn_error(text, user_role);
drop function t_rn_live(text); drop function t_rn_student(text);
select drop_assert_helpers();
\echo '  קישור הרשמה חדש וסכום חלקי: הכל עבר'
