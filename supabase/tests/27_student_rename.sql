-- 27_student_rename.sql — עריכת שם תלמידה (0043):
--   · השם מתעדכן בכל מקום: כרטיס, גבייה, נוכחות (גם דף האחראית), דוחות, ייצוא, דף התשלום, הוראות קבע.
--   · יומן: מי שינתה, מתי, מאיזה שם לאיזה — מכל מסלול.
--   · הודעות שעוד לא יצאו מקבלות את השם החדש; מה שיצא — נשאר כפי שנשלח.
--   · רק הבעלים ומנהלת הסניף; אותיות בלבד; בלי כפילות בסניף.
\set ON_ERROR_STOP on
\set SHIRA '''dddddddd-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\ir _assert.sql

\echo 'שינוי שם — מתעדכן בכל המסכים:'
begin;
-- קישור תשלום פתוח, תזכורת שעוד לא יצאה ותזכורת שכבר יצאה, מייל בתור ומייל שנשלח.
insert into payment_links (token, external_identifier, student_id, branch_id, amount) values (repeat('r', 64), 'x-ren-1', :SHIRA, :BEITAR, 100);
insert into reminders (kind, student_id, branch_id, to_phone, to_label, body, scheduled_at, status)
values ('debt', :SHIRA, :BEITAR, '972500000001', 'שירה כהן', 'שלום, תזכורת לתשלום של שירה כהן. תודה שירה! (שירות לקוחות)', now() + interval '1 day', 'scheduled'),
       ('debt', :SHIRA, :BEITAR, '972500000001', 'שירה כהן', 'הודעה ישנה לשירה כהן', now() - interval '1 day', 'sent');
insert into email_campaigns (id, subject, body) values ('eeeeeeee-0000-0000-0000-0000000005c1', 'עדכון ל{שם התלמידה}', 'גוף');
insert into email_messages (campaign_id, student_id, to_email, to_name, subject, body, status)
values ('eeeeeeee-0000-0000-0000-0000000005c1', :SHIRA, 'a@example.com', 'שירה כהן', 'עדכון לשירה כהן', 'שלום, שירה כהן', 'queued'),
       ('eeeeeeee-0000-0000-0000-0000000005c1', :SHIRA, 'a@example.com', 'שירה כהן', 'עדכון לשירה כהן', 'שלום, שירה כהן', 'sent');

set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((rpc_rename_student(:SHIRA, '  שירה ', ' כהן־לוי ') ->> 'ok')::boolean, 'הבעלים משנה שם (רווחים מסביב נחתכים)');
select assert_true((select full_name = 'שירה כהן־לוי' and first_name = 'שירה' and last_name = 'כהן־לוי' from students where id = :SHIRA), 'השם נשמר: מלא, פרטי ומשפחה');
select assert_true((select full_name from v_student_overview where id = :SHIRA) = 'שירה כהן־לוי', '★ כרטיס ורשימת התלמידות');
select assert_true((select full_name from v_student_balance where student_id = :SHIRA) = 'שירה כהן־לוי', '★ גבייה (יתרות)');
select assert_true(not exists (select 1 from v_debtors where full_name = 'שירה כהן') , '★ גבייה (חייבות) — השם הישן לא מופיע');
select assert_true((select count(*) = 0 from v_students_accounting where full_name = 'שירה כהן'), '★ דוחות (הנהלת חשבונות) — השם הישן לא מופיע');
select assert_true(exists (select 1 from rpc_students_export(null) r where r ->> 'full_name' = 'שירה כהן־לוי'), '★ ייצוא לאקסל');
select assert_true(rpc_payment_link_public(repeat('r', 64)) ->> 'student' = 'שירה', '★ דף התשלום של ההורה (שם פרטי)');
reset role;
select assert_true(exists (select 1 from jsonb_array_elements(rpc_attendance_sheet((select token from attendance_links where branch_id = :BEITAR and is_active limit 1)) -> 'students') x
                           where x ->> 'full_name' = 'שירה כהן־לוי' or x ->> 'name' = 'שירה כהן־לוי'), '★ דף הנוכחות של האחראית');

-- ★ יומן: מי, מתי, מאיזה שם לאיזה.
select assert_true((select actor = 'user:' || t_user('owner'::user_role)::text and before ->> 'full_name' = 'שירה כהן' and after ->> 'full_name' = 'שירה כהן־לוי'
                    from audit_log where action = 'rename_student' and row_id = :SHIRA), '★ ביומן: מי שינתה, ממה ולמה');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select changed_by = (select full_name from profiles where id = t_user('owner'::user_role)) and from_name = 'שירה כהן' and to_name = 'שירה כהן־לוי' and changed_at is not null
                    from rpc_student_name_history(:SHIRA)), '★ היסטוריית השם בכרטיס: מתי, מי, מאיזה לאיזה');
reset role;

-- ★ הודעות שעוד לא יצאו — עם השם החדש. שכבר יצאו — כפי שנשלחו.
select assert_true((select to_label = 'שירה כהן־לוי' and body = 'שלום, תזכורת לתשלום של שירה כהן־לוי. תודה שירה! (שירות לקוחות)' from reminders where student_id = :SHIRA and status = 'scheduled' and kind = 'debt'),
                   '★ תזכורת שעוד לא יצאה — עם השם החדש');
select assert_true((select body = 'הודעה ישנה לשירה כהן' and to_label = 'שירה כהן' from reminders where student_id = :SHIRA and status = 'sent'), '★ תזכורת שכבר יצאה — נשארת כפי שנשלחה (תיעוד)');
select assert_true((select subject = 'עדכון לשירה כהן־לוי' and body = 'שלום, שירה כהן־לוי' and to_name = 'שירה כהן־לוי' from email_messages where student_id = :SHIRA and status = 'queued'), 'מייל בתור — עם השם החדש');
select assert_true((select subject = 'עדכון לשירה כהן' from email_messages where student_id = :SHIRA and status = 'sent'), 'מייל שנשלח — כפי שנשלח');
rollback;

\echo 'השם הפרטי בהודעה — מילה שלמה, לא בתוך מילה אחרת:'
select assert_true(f_rename_in_text('שלום, תזכורת לשירה כהן: של שירה ושירה. שירות. לשירהלה', 'שירה כהן', 'שירי לוי', 'שירה', 'שירי')
                   = 'שלום, תזכורת לשירי לוי: של שירי ושירי. שירות. לשירהלה', 'מלא בכל מקום; פרטי כמילה (גם עם אות שימוש), לא בתוך מילה');
select assert_true(f_rename_in_text('רות לוי / שירות / ורות / רותי', 'רות לוי', 'רותם לוי', 'רות', 'רותם') = 'רותם לוי / שירות / ורותם / רותי', '"רות" לא נוגעת ב"שירות" וב"רותי"');
select assert_true(f_rename_in_text('של שירה כהן', 'שירה כהן', 'שירה לוי', 'שירה', 'שירה') = 'של שירה לוי', 'רק שם המשפחה השתנה');

\echo 'כללים והרשאות:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
do $$
declare v text;
begin
  foreach v in array array['', '   ', 'שירה1', '<b>x</b>'] loop
    begin
      perform rpc_rename_student('dddddddd-0000-0000-0000-000000000001', v, 'כהן');
      perform assert_true(false, format('שם פרטי פגום "%s" — נדחה', v));
    exception when others then
      if sqlerrm like '%✗%' then raise; end if;
    end;
  end loop;
  perform assert_true(true, 'שם ריק / רווחים / ספרות / תגיות — נדחה');
end $$;
do $$ begin
  perform rpc_rename_student('dddddddd-0000-0000-0000-000000000001', 'שירה', 'כהן');
  perform assert_true(false, 'אותו שם — "השם לא השתנה"');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlerrm = 'השם לא השתנה', 'אותו שם — "השם לא השתנה"');
end $$;
-- כפילות: תלמידה אחרת באותו סניף ואותה עונה.
do $$
declare v_other text;
begin
  select full_name into v_other from students where branch_id = 'bbbbbbbb-0000-0000-0000-000000000001' and id <> 'dddddddd-0000-0000-0000-000000000001'
     and deleted_at is null and cancelled_at is null and season_id = (select season_id from students where id = 'dddddddd-0000-0000-0000-000000000001') limit 1;
  perform rpc_rename_student('dddddddd-0000-0000-0000-000000000001', split_part(v_other, ' ', 1), substr(v_other, length(split_part(v_other, ' ', 1)) + 2));
  perform assert_true(false, '★ שם של תלמידה אחרת בסניף — נדחה');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlerrm like 'כבר יש בסניף תלמידה בשם%', '★ שם של תלמידה אחרת בסניף — נדחה');
end $$;
select assert_true((select full_name = 'שירה כהן' from students where id = :SHIRA), 'בקשות שנדחו — השם לא השתנה');

-- מנהלת הסניף — כן. מנהלת סניף אחר / רואת חשבון — לא.
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_true((rpc_rename_student(:SHIRA, 'שירה', 'אברהם') ->> 'ok')::boolean, 'מנהלת הסניף משנה שם של תלמידה בסניף שלה');
select assert_eq((select count(*) from rpc_student_name_history(:SHIRA)), 1, 'מנהלת הסניף רואה את היסטוריית השם');
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
do $$ begin
  perform rpc_rename_student('dddddddd-0000-0000-0000-000000000001', 'מישהי', 'אחרת');
  perform assert_true(false, '★ רואת חשבון לא משנה שם');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlstate = '42501', '★ רואת חשבון לא משנה שם');
end $$;
reset role;
-- מנהלת סניף אחר: משייכים את מנהלת הבדיקה לסניף אחר בלבד.
update students set branch_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = :SHIRA;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
do $$ begin
  perform rpc_rename_student('dddddddd-0000-0000-0000-000000000001', 'מישהי', 'אחרת');
  perform assert_true(false, '★ מנהלת סניף אחר לא משנה שם');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlstate = '42501', '★ מנהלת סניף אחר לא משנה שם');
end $$;
select assert_eq((select count(*) from rpc_student_name_history(:SHIRA)), 0, 'מנהלת סניף אחר לא רואה את ההיסטוריה');
reset role;
-- תלמידה שנמחקה — לא.
update students set branch_id = :BEITAR, deleted_at = now() where id = :SHIRA;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
do $$ begin
  perform rpc_rename_student('dddddddd-0000-0000-0000-000000000001', 'מישהי', 'אחרת');
  perform assert_true(false, 'תלמידה שנמחקה — לא משנים שם');
exception when others then
  if sqlerrm like '%✗%' then raise; end if;
  perform assert_true(sqlerrm like 'התלמידה נמחקה%', 'תלמידה שנמחקה — לא משנים שם');
end $$;
reset role;
select assert_no_execute('anon', 'rpc_rename_student(uuid, text, text)');
select assert_no_execute('anon', 'rpc_student_name_history(uuid)');
select assert_no_execute('authenticated', 'f_rename_in_text(text, text, text, text, text)');
rollback;

\echo 'יומן — גם שינוי שלא דרך הכרטיס:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
update students set full_name = 'שירה עדכון ישיר' where id = :SHIRA;
reset role;
select assert_true((select actor = 'user:' || t_user('owner'::user_role)::text and after ->> 'full_name' = 'שירה עדכון ישיר' from audit_log where action = 'rename_student' and row_id = :SHIRA),
                   '★ עדכון ישיר של השם — גם נרשם ביומן, עם מי שעדכנה');
select set_config('request.jwt.claims', '{}', true);   -- בלי משתמשת (cron, ייבוא, service_role)
update students set full_name = 'שירה מהמערכת' where id = :SHIRA;
select assert_true((select actor = 'system' from audit_log where action = 'rename_student' and row_id = :SHIRA and after ->> 'full_name' = 'שירה מהמערכת'), 'שינוי מהמערכת (בלי משתמשת) — נרשם כ"מערכת"');
update students set notes = 'הערה' where id = :SHIRA;
select assert_eq((select count(*) from audit_log where action = 'rename_student' and row_id = :SHIRA), 2, 'עדכון של שדה אחר — לא נרשם כשינוי שם');
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select changed_by from rpc_student_name_history(:SHIRA) order by changed_at desc, from_name limit 1) in ('המערכת', (select full_name from profiles where id = t_user('owner'::user_role))), 'בהיסטוריה: "המערכת" או שם המשתמשת');
reset role;
rollback;
\echo '  עריכת שם תלמידה: הכל עבר'
