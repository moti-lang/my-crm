-- 23_commands_screen.sql — מסך "פקודות וואטסאפ" (0038): מספרים מורשים, ביטול מהמסך.
\set ON_ERROR_STOP on
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

\echo 'מספרים מורשים:'
begin;
-- (ב-seed יש כבר שלושה מספרים; כאן מספרים חדשים.)
insert into authorized_numbers (phone, label, scope) values ('050-777 0001', '  מירי  ', 'all');
select assert_true((select phone = '972507770001' and label = 'מירי' from authorized_numbers where label = 'מירי'),
  '★ הטלפון נשמר כמו שה-webhook מזהה את השולחת (972…), גם כשהוקלד 050-…');
select assert_true((select f_normalize_phone('+972-50-123-4567') = '972501234567' and f_normalize_phone('0501234567') = '972501234567'),
  'נרמול זהה ל-normalizePhone של הפונקציות');
select assert_no_effect('★ אותו מספר בכתיב אחר — נדחה (כבר ברשימה)',
  $a$insert into authorized_numbers (phone, label) values ('+972 50-777-0001', 'כפול')$a$,
  $p$select count(*)::text from authorized_numbers$p$);
select assert_no_effect('★ מספר של סניף בלי סניף — נדחה',
  $a$insert into authorized_numbers (phone, label, scope) values ('0507770002', 'רבקי', 'branch')$a$,
  $p$select count(*)::text from authorized_numbers$p$);
select assert_no_effect('רמת הרשאה לא מוכרת — נדחית',
  $a$insert into authorized_numbers (phone, label, scope) values ('0507770003', 'x', 'superuser')$a$,
  $p$select count(*)::text from authorized_numbers$p$);
select assert_no_effect('טלפון לא תקין — נדחה',
  $a$insert into authorized_numbers (phone, label) values ('12', 'x')$a$,
  $p$select count(*)::text from authorized_numbers$p$);
insert into authorized_numbers (phone, label, scope, branch_id) values ('0507770004', 'דבורה', 'finance', :BEITAR);
select assert_true((select branch_id is null from authorized_numbers where label = 'דבורה'), 'סניף ברמה שאינה "סניף" — מתנקה (לא מטעה)');
insert into authorized_numbers (phone, label, scope, branch_id) values ('0507770005', 'חני', 'branch', :BEITAR);
select assert_true((select branch_id = :BEITAR from authorized_numbers where label = 'חני'), 'מספר של סניף נשמר עם הסניף');

-- RLS: רק הבעלים.
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from authorized_numbers), 0, '★ מנהלת סניף לא רואה מספרים מורשים');
select assert_eq((select count(*) from commands), 0, '★ מנהלת סניף לא רואה את יומן הפקודות');
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select count(*) from authorized_numbers where phone like '9725077700%'), 3, 'הבעלים רואה את כל המספרים');
-- ★ ההוספה מהמסך רצה בהרשאות הבעלים (לא כמנהל המסד) — כולל הטריגר והנרמול.
insert into authorized_numbers (phone, label, scope) values ('050-777-0006', 'מהמסך', 'all');
select assert_true((select phone = '972507770006' from authorized_numbers where label = 'מהמסך'), '★ הבעלים מוסיפה מספר מהמסך — נשמר מנורמל');
update authorized_numbers set is_active = false where label = 'חני';
select assert_true((select not is_active from authorized_numbers where label = 'חני'), 'הבעלים משביתה מספר מהמסך');
reset role;
rollback;

\echo 'ביטול פעולה מהמסך (rpc_owner_cancel_command):'
begin;
-- המספר של הבעלים מה-seed (972501234567).
-- פקודה אמיתית דרך המנוע: ממתינה → "כן" → בוצעה.
select rpc_create_pending_command('972501234567', 'שילמתי 860 תלבושות בביתר',
  '{"intent":"expense","confidence":0.94,"fields":{"amount":860,"branch":"ביתר עילית","category":"תלבושות"},"missing":[],"human_summary":"הוצאה של 860"}'::jsonb, 'expense') as cmd \gset
select assert_true((rpc_execute_command(:'cmd') ->> 'ok')::boolean, 'הפקודה בוצעה דרך המנוע');
select assert_true((select deleted_at is null from ledger_entries where id = (select result_id from commands where id = :'cmd')), 'ההוצאה נרשמה');

set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_no_effect('★ מנהלת סניף לא יכולה לבטל פקודה',
  format($a$select rpc_owner_cancel_command(%L)$a$, :'cmd'),
  format($p$select status::text from commands where id = %L$p$, :'cmd'));
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_owner_cancel_command(:'cmd') ->> 'ok')::boolean, '★ הבעלים מבטלת מהמסך');
reset role;
select assert_true((select status = 'cancelled' from commands where id = :'cmd'), 'הפקודה מסומנת "בוטל"');
select assert_true((select deleted_at is not null from ledger_entries where id = (select result_id from commands where id = :'cmd')),
  '★ ההוצאה הוסרה (אותו היפוך כמו "בטל" בוואטסאפ)');
select assert_true(exists (select 1 from audit_log where action = 'cancel_command' and row_id = :'cmd' and actor like 'user:%'), 'נרשם מי ביטלה מהמסך');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true(not (rpc_owner_cancel_command(:'cmd') ->> 'ok')::boolean, 'ביטול שני — לא מבטל פעמיים');
reset role;

-- ישנה מ-24 שעות: לא מתבטלת.
select rpc_create_pending_command('972501234567', 'תוסיפי הכנסה 5000 חסויות',
  '{"intent":"income","confidence":0.9,"fields":{"amount":5000,"category":"חסויות"},"missing":[],"human_summary":"הכנסה של 5000"}'::jsonb, 'income') as old \gset
select rpc_execute_command(:'old');
update commands set created_at = now() - interval '25 hours' where id = :'old';
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_owner_cancel_command(:'old') ->> 'reason') = 'too_old', '★ פעולה מלפני יותר מ-24 שעות — לא מתבטלת');
reset role;
select assert_no_execute('anon', 'rpc_owner_cancel_command(uuid)');
select assert_true((select channel = 'whatsapp' from commands where id = :'cmd'), 'פקודה מוואטסאפ מסומנת whatsapp כברירת מחדל');
select assert_no_effect('ערוץ לא מוכר — נדחה',
  format($a$update commands set channel = 'sms' where id = %L$a$, :'cmd'),
  format($p$select channel from commands where id = %L$p$, :'cmd'));
rollback;
\echo '  כל בדיקות מסך הפקודות עברו'
