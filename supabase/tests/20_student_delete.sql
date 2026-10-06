-- 20_student_delete.sql — מחיקת תלמידה: רכה, בעלים בלבד, והדוחות הכספיים לא זזים.
\set ON_ERROR_STOP on
\set SHIRA '''dddddddd-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

-- צילום של דוחות ההכנסות (חודשי + לפי סניף), כפי שהבעלים רואה אותם.
create or replace function t_income_snapshot() returns text language sql stable as $$
  select coalesce((select json_agg(x order by x.season_id, x.month)::text
                     from (select season_id, month, income_students, income_other, expenses, profit from v_pnl_monthly) x), '∅')
         || ' | ' ||
         coalesce((select json_agg(y order by y.branch_id)::text
                     from (select branch_id, income_students, income_registration_fees, income_other, expenses from v_branch_pnl) y), '∅') $$;

\echo 'מחיקת תלמידה — הדוחות הכספיים לא משתנים:'
begin;
-- קישור פתוח ותזכורת מתוזמנת — אמורים להתבטל.
insert into payment_links (token, external_identifier, student_id, branch_id, amount) values (repeat('a', 64), 'x-del-1', :SHIRA, :BEITAR, 100);
insert into reminders (kind, student_id, branch_id, to_phone, body, scheduled_at) values ('debt', :SHIRA, :BEITAR, '972500000001', 'תזכורת', now() + interval '1 day');

set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select t_income_snapshot() as snap_before \gset
select assert_true((select sum(income_students) from v_pnl_monthly where month = '2026-07-01') >= 2000, 'הצילום כולל את התשלומים של התלמידה (לא בדיקה ריקה)');

select rpc_delete_student(:SHIRA);
select assert_true(t_income_snapshot() = :'snap_before', '★ דוח ההכנסות (חודשי + סניפים) זהה לפני ואחרי מחיקת התלמידה');
select assert_eq((select count(*) from payments where student_id = :SHIRA and deleted_at is null), 3, '★ התשלומים שלה נשארו, לא נמחקו');
select assert_eq((select count(*) from v_student_overview where id = :SHIRA), 0, 'הכרטיס מוסתר מרשימת התלמידות');
reset role;
select assert_true('יש תשלומים' = any(f_purge_blockers(:SHIRA)) and 'יש נוכחות' = any(f_purge_blockers(:SHIRA)), 'f_purge_blockers: תשלומים ונוכחות חוסמים');
select assert_eq((select count(*) from attendance where student_id = :SHIRA), 4, 'היסטוריית הנוכחות נשארה');
select assert_true((select status = 'cancelled' from payment_links where external_identifier = 'x-del-1'), '★ קישור תשלום פתוח בוטל');
select assert_true((select status = 'cancelled' from reminders where student_id = :SHIRA and body = 'תזכורת'), '★ תזכורת מתוזמנת בוטלה');
select assert_no_effect('★ קישור תשלום חדש לתלמידה מחוקה', format($a$insert into payment_links (token, external_identifier, student_id, branch_id, amount) values (repeat('b', 64), 'x-del-2', %L, %L, 50)$a$, :SHIRA, :BEITAR),
                        $q$select count(*)::text from payment_links$q$);

-- שחזור
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select count(*) = 1 from rpc_deleted_students() where id = :SHIRA and paid = 2000 and 'יש תשלומים' = any(purge_blockers)), 'ברשימת המחוקות: עם הסכום ששילמה ומה שחוסם מחיקה סופית');
select assert_no_effect('★ מחיקה סופית של תלמידה עם תשלומים', format('select rpc_purge_student(%L)', :SHIRA), $q$select count(*)::text from students$q$);
select rpc_restore_student(:SHIRA);
select assert_eq((select count(*) from v_student_overview where id = :SHIRA), 1, 'שחזור: הכרטיס חזר');
select assert_true(t_income_snapshot() = :'snap_before', 'ואחרי השחזור — הדוח עדיין זהה');
rollback;

\echo 'הרשאות וחסימות:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('★ מנהלת סניף לא מוחקת תלמידה', format('select rpc_delete_student(%L)', :SHIRA), $q$select count(*)::text from students where deleted_at is null$q$);
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_no_effect('★ רואת חשבון לא מוחקת תלמידה', format('select rpc_delete_student(%L)', :SHIRA), $q$select count(*)::text from students where deleted_at is null$q$);
reset role;
select assert_no_effect('★ מחיקה פיזית ישירה של תלמידה עם תשלומים — נחסמת במסד', format('delete from students where id = %L', :SHIRA), $q$select count(*)::text from payments$q$);

-- הוראת קבע פעילה חוסמת
insert into payment_links (id, token, external_identifier, student_id, branch_id, amount, status) values ('eeeeeeee-0000-0000-0000-0000000000d1', repeat('c', 64), 'x-del-3', :SHIRA, :BEITAR, 100, 'paid');
insert into standing_orders (student_id, branch_id, payment_link_id, sumit_customer_id, amount, installments, installments_total, date_start, consent_text, consented_at)
values (:SHIRA, :BEITAR, 'eeeeeeee-0000-0000-0000-0000000000d1', 1, 100, 9, 900, current_date, 'אישור', now());
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
do $$ begin
  perform rpc_delete_student('dddddddd-0000-0000-0000-000000000001');
  raise exception 'לא נחסם';
exception when others then
  if sqlerrm <> 'יש הוראת קבע פעילה, צריך לעצור אותה קודם' then raise exception '  ✗ ★ הוראת קבע פעילה: הודעה שגויה: %', sqlerrm; end if;
  raise notice '  ✓ ★ הוראת קבע פעילה חוסמת: "%"', sqlerrm;
end $$;
select assert_eq((select count(*) from students where id = :SHIRA and deleted_at is null), 1, 'והתלמידה לא נמחקה');
rollback;

\echo 'מחיקה סופית — רק בלי היסטוריה:'
begin;
insert into students (id, season_id, branch_id, full_name, status) values ('dddddddd-0000-0000-0000-0000000000f1', (select id from seasons where is_current), :BEITAR, 'נרשמה בטעות', 'pending');
insert into reminders (kind, student_id, branch_id, to_phone, body, scheduled_at) values ('general', 'dddddddd-0000-0000-0000-0000000000f1', :BEITAR, '972500000002', 'ברוכה הבאה', now());
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select t_income_snapshot() as snap_before \gset
select assert_no_effect('מחיקה סופית לפני מחיקה רכה — נחסמת', $a$select rpc_purge_student('dddddddd-0000-0000-0000-0000000000f1')$a$, $q$select count(*)::text from students$q$);
select rpc_delete_student('dddddddd-0000-0000-0000-0000000000f1');
select assert_true((select purge_blockers = '{}' from rpc_deleted_students() where id = 'dddddddd-0000-0000-0000-0000000000f1'), 'בלי היסטוריה — אין חוסמים');
select rpc_purge_student('dddddddd-0000-0000-0000-0000000000f1');
reset role;
select assert_eq((select count(*) from students where id = 'dddddddd-0000-0000-0000-0000000000f1'), 0, '★ מחיקה סופית: התלמידה נמחקה פיזית');
select assert_eq((select count(*) from reminders where student_id = 'dddddddd-0000-0000-0000-0000000000f1'), 0, 'והתזכורות שלה');
select assert_true((select count(*) = 1 from audit_log where action = 'purge' and row_id = 'dddddddd-0000-0000-0000-0000000000f1'), 'נרשם ביומן');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true(t_income_snapshot() = :'snap_before', 'הדוחות לא השתנו');
rollback;
drop function t_income_snapshot();
\echo '  כל בדיקות מחיקת התלמידה עברו'
