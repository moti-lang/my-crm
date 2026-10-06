-- 19_question_delete.sql — מחיקת שאלות: בעלים מוחקת, אחרות לא.
\set ON_ERROR_STOP on
\ir _assert.sql

\echo 'מחיקת שאלות:'
begin;
insert into faq_entries (id, question, answer, keywords, is_active) values ('f1000000-0000-0000-0000-000000000001', 'שאלה כללית', 'תשובה', '{}', true);
insert into faq_entries (id, question, answer, keywords, is_active, branch_id) values ('f1000000-0000-0000-0000-000000000002', 'שאלת סניף', 'תשובה', '{}', true, 'bbbbbbbb-0000-0000-0000-000000000001');
insert into unanswered_questions (id, question, resolved, faq_id) values ('f2000000-0000-0000-0000-000000000001', 'מה השעה?', true, 'f1000000-0000-0000-0000-000000000001');
insert into unanswered_questions (id, question) values ('f2000000-0000-0000-0000-000000000002', 'איפה החוג?');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', t_user('branch_manager'::user_role), 'role','authenticated')::text, true);
delete from faq_entries where id::text like 'f1000000%';
delete from unanswered_questions where id::text like 'f2000000%';
reset role;
select assert_eq((select count(*) from faq_entries where id::text like 'f1000000%'), 2, '★ מנהלת סניף לא מוחקת שאלות מהמאגר');
select assert_eq((select count(*) from unanswered_questions where id::text like 'f2000000%'), 2, '★ מנהלת סניף לא מוחקת שאלות ללא מענה');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', t_user('owner'::user_role), 'role','authenticated')::text, true);
delete from faq_entries where id = 'f1000000-0000-0000-0000-000000000001';
delete from faq_entries where id = 'f1000000-0000-0000-0000-000000000002';
delete from unanswered_questions where id = 'f2000000-0000-0000-0000-000000000002';
reset role;
select assert_eq((select count(*) from faq_entries where id::text like 'f1000000%'), 0, '★ בעלים מוחקת שאלה כללית ושאלת סניף — גם כשהיא קשורה לשאלה ללא מענה');
select assert_true((select faq_id is null and resolved from unanswered_questions where id = 'f2000000-0000-0000-0000-000000000001'), 'השאלה ללא מענה שהפכה לתשובה נשארת, בלי קישור');
select assert_eq((select count(*) from unanswered_questions where id = 'f2000000-0000-0000-0000-000000000002'), 0, '★ בעלים מוחקת שאלה ללא מענה');
rollback;
\echo '  כל בדיקות מחיקת השאלות עברו'
