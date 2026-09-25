-- 16_payment_links.sql — קישורי תשלום (SUMIT שלב א): נעילה לתלמידה ולסכום,
-- תפוגה, הדף הציבורי חושף מינימום, רישום אידמפוטנטי, הפרשים מתריעים.
\set ON_ERROR_STOP on
\set BEITAR   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN   '''bbbbbbbb-0000-0000-0000-000000000002'''
\ir _assert.sql

-- החייבת עם החוב הגדול בביתר, לפי הבעלים.
-- ישירות מהטבלאות, לא מהתצוגה (התצוגה מסננת לפי התפקיד של הקוראת).
create or replace function t_debtor(p_branch uuid) returns uuid language sql security definer set search_path = public, pg_temp as $$
  select s.id from students s
  where s.branch_id = p_branch and s.deleted_at is null and s.status = 'active' and s.parent_phone is not null
    and (s.tuition_total - s.discount) - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0) > 0
  order by (s.tuition_total - s.discount) - coalesce((select sum(amount) from payments p where p.student_id = s.id and p.deleted_at is null), 0) desc limit 1 $$;
create or replace function t_link_token(p_student uuid) returns text language sql security definer set search_path = public, pg_temp as $$
  select token from payment_links where student_id = p_student and status in ('pending','opened') order by created_at desc limit 1 $$;

\echo 'יצירה: הסכום נעול ליתרה, הודעה בתור:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_true((rpc_create_payment_link(t_debtor(:BEITAR)) ->> 'amount')::numeric = (select balance from v_student_balance where student_id = t_debtor(:BEITAR)), '★ מנהלת ביתר: הסכום = היתרה הפתוחה');
select assert_eq((select count(*) from reminders where kind = 'payment_link' and student_id = t_debtor(:BEITAR) and status = 'scheduled'), 1, '★ הודעת וואטסאפ עם הקישור נכנסה לתור');
select assert_true((select body like '%/pay/%' and body like '%7 ימים%' from reminders where kind = 'payment_link' and student_id = t_debtor(:BEITAR)), 'ההודעה מכילה את הקישור שלנו ואת התוקף');
select assert_true(length(t_link_token(t_debtor(:BEITAR))) = 64, 'טוקן של 64 תווי הקס (~244 ביט) — אי אפשר לנחש');
select assert_no_effect('★ סכום גדול מהחוב נדחה', format('select rpc_create_payment_link(%L, 999999)', t_debtor(:BEITAR)), 'select count(*)::text from payment_links');
select assert_no_effect('★ מנהלת ביתר לא יוצרת קישור לתלמידה במודיעין', format('select rpc_create_payment_link(%L)', t_debtor(:MODIIN)), 'select count(*)::text from payment_links');
-- קישור שני לאותה תלמידה מבטל את הראשון
select rpc_create_payment_link(t_debtor(:BEITAR), 100);
select assert_eq((select count(*) from payment_links where student_id = t_debtor(:BEITAR) and status in ('pending','opened')), 1, 'קישור חי אחד לתלמידה בכל רגע (הקודם בוטל)');
reset role; -- f_payment_link_alive פנימית (לא ל-authenticated); נבדקת ישירות כבעל המסד
select assert_true((select f_payment_link_alive(l) from payment_links l where status = 'pending' and student_id = t_debtor(:BEITAR)), 'f_payment_link_alive: pending עם תוקף — חי');
select assert_true((select bool_and(not f_payment_link_alive(l)) from payment_links l where status = 'cancelled' and student_id = t_debtor(:BEITAR)), 'f_payment_link_alive: מבוטל מת');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select rpc_cancel_payment_link((select id from payment_links where status = 'pending' and student_id = t_debtor(:BEITAR)));
select assert_eq((select count(*) from payment_links where status in ('pending','opened') and student_id = t_debtor(:BEITAR)), 0, 'ביטול ידני עובד');
reset role;
select assert_true(rpc_payment_links_to_sync()::text not like '%' || t_debtor(:BEITAR) || '%' and rpc_payment_links_to_sync()::text not like '%cancelled%', 'הסנכרון לא רואה קישורים מבוטלים');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_no_effect('★ רואת חשבון לא יוצרת קישור', format('select rpc_create_payment_link(%L)', t_debtor(:BEITAR)), 'select count(*)::text from payment_links');
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
create temp table t_s as select t_debtor(:BEITAR) as id;
update students set parent_phone = null where id = (select id from t_s);
select assert_no_effect('בלי טלפון של הורה — אין למי לשלוח, נדחה עם הסבר', format('select rpc_create_payment_link(%L)', (select id from t_s)), 'select count(*)::text from payment_links');
rollback;

\echo 'הדף הציבורי /pay/<טוקן>:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select rpc_create_payment_link(t_debtor(:BEITAR));
-- הטוקן נשמר לפני המעבר ל-anon: ל-anon אין דרך למצוא טוקן, רק לקבל אותו בוואטסאפ.
create temp table t_tok as select t_link_token(t_debtor(:BEITAR)) as token;
grant select on t_tok to anon;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select assert_true((rpc_payment_link_public((select token from t_tok)) ->> 'ok')::boolean, 'anon פותחת את הדף עם הטוקן');
select assert_true(rpc_payment_link_public((select token from t_tok))::text !~ '(972|parent_phone|balance|tuition|address|email|_id)', '★ הדף חושף רק שם פרטי, סניף, סכום ומצב — לא טלפון, לא מזהים');
select assert_true((rpc_payment_link_public('0000000000000000000000000000000000000000000000000000000000000000') ->> 'ok')::boolean = false, 'טוקן שגוי — לא נמצא, בלי רמז');
select assert_no_table_privilege('anon', '{payment_links}');
reset role;
select assert_eq((select count(*) from payment_links where status = 'opened'), 1, 'פתיחה נרשמת (opened)');
rollback;

\echo 'תפוגה 7 ימים:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
-- ייתכנו קישורים אמיתיים במסד (הענן): הבדיקה יחסית לקישור הזה בלבד.
select rpc_create_payment_link(t_debtor(:BEITAR));
reset role;
create temp table t_exp as select t_link_token(t_debtor(:BEITAR)) as token;
update payment_links set expires_at = now() - interval '1 hour' where token = (select token from t_exp);
select assert_true((rpc_payment_link_public((select token from t_exp)) ->> 'state') = 'expired', '★ אחרי 7 ימים הדף אומר שפג');
select assert_true((rpc_payment_link_set_page((select token from t_exp), 'https://x') ->> 'ok')::boolean = false, '★ ואי אפשר ליצור לו דף SUMIT');
select assert_true(rpc_payment_links_to_sync()::text like '%' || (select token from t_exp) || '%', 'קישור שפג לפני פחות מיומיים עדיין נבדק (תשלום ברגע האחרון)');
select assert_true(rpc_payment_links_mark_checked('{}') >= 1, 'הסנכרון מסמן אותו expired');
select assert_true((select status = 'expired' from payment_links where token = (select token from t_exp)), 'סטטוס expired');
rollback;

\echo 'רישום תשלום מ-SUMIT — אידמפוטנטי:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select rpc_create_payment_link(t_debtor(:BEITAR));
reset role;
create temp table t_ctx as select external_identifier as ext, amount, student_id, token from payment_links where student_id = t_debtor(:BEITAR) and status in ('pending','opened');
select assert_true((select (rpc_record_sumit_payment(ext, 'SUMIT-1', amount, now(), 'DOC-1') ->> 'ok')::boolean from t_ctx), '★ תשלום שאושר ב-SUMIT נרשם');
select assert_eq((select count(*) from payments where source = 'sumit' and student_id = (select student_id from t_ctx)), 1, 'תשלום אחד ב-payments, מקור sumit');
select assert_true((select balance = 0 from v_student_balance where student_id = (select student_id from t_ctx)), '★ היתרה התעדכנה לאפס');
select assert_true((select (rpc_record_sumit_payment(ext, 'SUMIT-1', amount, now(), 'DOC-1') ->> 'duplicate')::boolean from t_ctx), '★ אותה הודעה פעמיים — לא נרשם שוב');
select assert_eq((select count(*) from payments where source = 'sumit' and student_id = (select student_id from t_ctx)), 1, 'עדיין תשלום אחד');
select assert_true((select status = 'paid' from payment_links where token = (select token from t_ctx)), 'הקישור סומן paid');
select assert_true((rpc_payment_link_public((select token from t_ctx)) ->> 'state') = 'paid', 'הדף הציבורי מראה "שולם"');
select assert_eq((select count(*) from v_payment_reconciliation where issue is not null and student_id = (select student_id from t_ctx)), 0, 'ההתאמה נקייה');
rollback;

\echo 'הפרש סכום ותשלום יתום — התראה, לא שקט:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select rpc_create_payment_link(t_debtor(:BEITAR));
reset role;
create temp table t_mm as select student_id from payment_links where student_id = t_debtor(:BEITAR) and status in ('pending','opened');
select assert_true((select (rpc_record_sumit_payment(external_identifier, 'SUMIT-2', amount - 50, now(), null) ->> 'status') = 'mismatch' from payment_links where student_id = (select student_id from t_mm) and status in ('pending','opened')), '★ סכום שונה — נרשם מה שנגבה בפועל, מסומן mismatch');
select assert_eq((select count(*) from system_alerts where kind = 'sumit_amount_mismatch'), 1, '★ התראה לבעלים על ההפרש');
select assert_eq((select count(*) from v_payment_reconciliation where issue = 'סכום שונה' and student_id = (select student_id from t_mm)), 1, 'ההפרש בולט במסך ההתאמה');
select assert_true((rpc_record_sumit_payment('tl-does-not-exist', 'SUMIT-3', 100, now(), null) ->> 'reason') = 'no_link', 'תשלום בלי קישור אצלנו — לא נרשם');
select assert_eq((select count(*) from system_alerts where kind = 'sumit_orphan_payment'), 1, '★ תשלום יתום — התראה קריטית');
rollback;

\echo 'הרשאות:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select rpc_create_payment_link(t_debtor(:BEITAR));
select rpc_create_payment_link(t_debtor(:MODIIN));
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from payment_links where branch_id <> :BEITAR), 0, '★ מנהלת ביתר לא רואה קישור של סניף אחר');
select assert_true((select count(*) from payment_links where branch_id = :BEITAR) >= 1, 'ורואה את של ביתר');
select assert_eq((select count(*) from v_payment_reconciliation where branch_id <> :BEITAR), 0, 'וגם בהתאמה');
select assert_no_effect('★ מנהלת לא כותבת ישירות לטבלת הקישורים', $a$update payment_links set amount = 1$a$, $p$select string_agg(amount::text, ',') from payment_links$p$);
select assert_no_effect('★ מנהלת לא מריצה את רישום התשלום (service_role בלבד)', $a$select rpc_record_sumit_payment('x', 'y', 1, now(), null)$a$, 'select count(*)::text from payments');
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_true((select count(distinct branch_id) from v_payment_reconciliation) >= 2, 'רואת חשבון רואה את כל ההתאמה');
rollback;

drop function if exists t_debtor(uuid);
drop function if exists t_link_token(uuid);
select drop_assert_helpers();
\echo '─────────────────────────────────────────'
