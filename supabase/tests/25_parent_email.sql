-- 25_parent_email.sql — מיילים להורים (0040): הרשאות, הסרה מהתפוצה, התור, אירועי מסירה.
\set ON_ERROR_STOP on
\set SEASON '''aaaaaaaa-0000-0000-0000-000000000001'''
\set BEITAR '''bbbbbbbb-0000-0000-0000-000000000001'''
\set A '''eeeeeeee-0000-0000-0000-00000000ea01'''
\set B '''eeeeeeee-0000-0000-0000-00000000ea02'''
\set C '''eeeeeeee-0000-0000-0000-00000000ea03'''
\set CAMP '''eeeeeeee-0000-0000-0000-00000000ec01'''
\ir _assert.sql

begin;
-- שתי אחיות עם אותה כתובת (A, B), ועוד תלמידה (C).
insert into students (id, season_id, branch_id, full_name, parent_name, email, mailing_consent, status)
values (:A, :SEASON, :BEITAR, 'אחות א', 'רחל', 'Rachel.Mail@Example.com', true, 'active'),
       (:B, :SEASON, :BEITAR, 'אחות ב', 'רחל', 'rachel.mail@example.com', true, 'active'),
       (:C, :SEASON, :BEITAR, 'שלישית', 'לאה', 'leah.mail@example.com', true, 'active');
insert into email_campaigns (id, subject, body, attachment_name, attachment_b64) values (:CAMP, 'נושא', 'גוף', 'a.pdf', 'QUJD');
insert into email_messages (campaign_id, student_id, to_email, to_name, subject, body)
values (:CAMP, :A, 'rachel.mail@example.com', 'רחל', 'נושא', 'גוף א'),
       (:CAMP, :B, 'rachel.mail@example.com', 'רחל', 'נושא', 'גוף ב'),
       (:CAMP, :C, 'leah.mail@example.com', 'לאה', 'נושא', 'גוף ג');

\echo 'הטבלאות:'
select assert_true((select bool_and(unsubscribe_token ~ '^[0-9a-f]{36}$') from email_messages where campaign_id = :CAMP), 'לכל הודעה טוקן הסרה אקראי (36 תווים)');
select assert_true((select count(distinct unsubscribe_token) = 3 from email_messages where campaign_id = :CAMP), 'הטוקנים שונים');
select assert_no_effect('כתובת לא מנורמלת (אותיות גדולות) — נדחית',
  format($a$insert into email_messages (campaign_id, to_email, subject, body) values (%L, 'Big@Example.com', 's', 'b')$a$, :CAMP),
  $p$select count(*)::text from email_messages$p$);
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_eq((select count(*) from email_messages where campaign_id = :CAMP), 3, 'הבעלים רואה את היומן');
select assert_true((select total = 3 and pending = 3 from v_email_campaigns where id = :CAMP), 'היומן: 3 מיילים, 3 ממתינים');
select assert_no_effect('★ גם הבעלים לא כותבת לתור ישירות (רק דרך הפונקציה בשרת)',
  format($a$insert into email_messages (campaign_id, to_email, subject, body) values (%L, 'x@example.com', 's', 'b')$a$, :CAMP),
  $p$select count(*)::text from email_messages$p$);
select assert_no_effect('★ ...ולא מוחקת הסרה מהתפוצה', $a$delete from email_suppressions$a$, $p$select count(*)::text from email_suppressions$p$);
select set_config('request.jwt.claims', t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from email_messages), 0, '★ מנהלת סניף לא רואה את יומן המיילים');
select set_config('request.jwt.claims', t_claims('accountant'::user_role), true);
select assert_eq((select count(*) from email_campaigns), 0, '★ רואת חשבון לא רואה');
reset role;

\echo 'התור (rpc_email_claim):'
select assert_no_execute('authenticated', 'rpc_email_claim(integer, integer)');
select assert_no_execute('authenticated', 'rpc_email_event(text, text, text)');
set local role service_role;
select assert_eq((select count(*) from rpc_email_claim(1, 100)), 1, 'לוקחת עד המגבלה');
select assert_eq((select count(*) from email_messages where campaign_id = :CAMP and status = 'sending'), 1, '...ומסמנת "נשלחת"');
select assert_eq((select count(*) from rpc_email_claim(10, 2)), 1, '★ תקרה יומית: 2 ביום — אחת כבר יצאה היום, נשארה אחת');
select assert_eq((select count(*) from rpc_email_claim(10, 2)), 0, '★ התקרה מוצתה — כלום עד מחר');
-- (שלוש ההודעות נוצרו באותו רגע, כך שאיזו נלקחה ראשונה — אקראי. "התקועה" היא אחת מאלה שנלקחו.)
select id as stuck from email_messages where campaign_id = :CAMP and status = 'sending' order by id limit 1 \gset
update email_messages set sending_at = now() - interval '20 minutes' where id = :'stuck';
select assert_eq((select count(*) from rpc_email_claim(10, 100)), 1, 'עוד אחת בתור');
select assert_true((select status = 'failed' and error like 'השליחה נקטעה%' from email_messages where id = :'stuck'),
  '★ תקועה ב"נשלחת" 20 דקות — "נכשלה", ולא נשלחת שוב לבד (כפילות גרועה מחסר)');
update email_messages set status = 'sent' where campaign_id = :CAMP and status = 'sending';
select rpc_email_claim(10, 100);
select assert_true((select attachment_b64 is null from email_campaigns where id = :CAMP), 'כל ההודעות יצאו — הצרופה נמחקה מהמסד');
reset role;

\echo 'אירועי מסירה (rpc_email_event):'
update email_messages set provider_id = 'p-a' where student_id = :A;
update email_messages set provider_id = 'p-b' where student_id = :B;
update email_messages set provider_id = 'p-c', status = 'sent' where student_id = :C;
set local role service_role;
select rpc_email_event('p-c', 'email.delivered');
select assert_true((select status = 'delivered' and delivered_at is not null from email_messages where student_id = :C), 'נמסר');
select assert_true((rpc_email_event('לא-קיים', 'email.delivered') ->> 'found') = 'false', 'מזהה לא מוכר — מתעלמים');
-- הודעה נוספת ממתינה לאותה כתובת, ואז חזרה קבועה.
insert into email_messages (campaign_id, student_id, to_email, subject, body) values (:CAMP, :C, 'leah.mail@example.com', 'עוד', 'עוד');
select rpc_email_event('p-c', 'email.bounced', 'mailbox does not exist');
reset role;
select assert_true((select status = 'bounced' and error = 'mailbox does not exist' from email_messages where provider_id = 'p-c'), 'חזר — עם הסיבה');
select assert_true((select reason = 'bounce' from email_suppressions where email = 'leah.mail@example.com'), '★ חזרה קבועה — הכתובת נחסמת');
select assert_true((select status = 'cancelled' from email_messages where subject = 'עוד'), '★ ...והממתינה אליה בוטלה');
set local role service_role;
select rpc_email_event('p-b', 'email.complained');
reset role;
select assert_true((select reason = 'complaint' from email_suppressions where email = 'rachel.mail@example.com'), '★ סומן כספאם — הכתובת נחסמת');
select assert_true((select bool_and(not mailing_consent) from students where id in (:A, :B)), '★ ...וההסכמה בוטלה לשתי האחיות');
rollback;

\echo 'הסרה מהתפוצה (קישור בתחתית המייל):'
begin;
insert into students (id, season_id, branch_id, full_name, parent_name, email, mailing_consent, status)
values (:A, :SEASON, :BEITAR, 'אחות א', 'רחל', 'rachel.mail@example.com', true, 'active'),
       (:B, :SEASON, :BEITAR, 'אחות ב', 'רחל', ' Rachel.Mail@example.com ', true, 'active'),
       (:C, :SEASON, :BEITAR, 'שלישית', 'לאה', 'leah.mail@example.com', true, 'active');
insert into email_campaigns (id, subject, body) values (:CAMP, 'נושא', 'גוף');
insert into email_messages (campaign_id, student_id, to_email, subject, body, status)
values (:CAMP, :A, 'rachel.mail@example.com', 'נושא', 'א', 'sent'),
       (:CAMP, :B, 'rachel.mail@example.com', 'נושא', 'ב', 'queued'),
       (:CAMP, :C, 'leah.mail@example.com', 'נושא', 'ג', 'queued');
select unsubscribe_token as tok from email_messages where student_id = :A \gset
set local role anon;
select assert_true(not (rpc_email_unsubscribe('xyz') ->> 'ok')::boolean, 'טוקן לא תקין — לא מזוהה');
select assert_true(not (rpc_email_unsubscribe(repeat('0', 36)) ->> 'ok')::boolean, 'טוקן שלא קיים — לא מזוהה');
select assert_true((select r ->> 'email' = 'r***@example.com' and not (r ->> 'unsubscribed')::boolean from rpc_email_unsubscribe(:'tok') r),
  'פתיחת הקישור: רק מציגה (הכתובת מוסתרת חלקית) — לא מסירה');
reset role;
select assert_eq((select count(*) from email_suppressions where email = 'rachel.mail@example.com'), 0, '★ פתיחת הקישור לבד לא מסירה (סורקי קישורים)');
set local role anon;
select assert_true((rpc_email_unsubscribe(:'tok', true) ->> 'unsubscribed')::boolean, '★ אישור — הוסרה (בלי התחברות)');
reset role;
select assert_true((select reason = 'unsubscribe' from email_suppressions where email = 'rachel.mail@example.com'), 'הכתובת ברשימת ההסרה');
select assert_true((select bool_and(not mailing_consent) from students where id in (:A, :B)), '★ ההסכמה בוטלה לכל התלמידות עם הכתובת (גם בכתיב אחר)');
select assert_true((select mailing_consent from students where id = :C), 'תלמידה אחרת — לא נגעו');
select assert_true((select status = 'cancelled' from email_messages where student_id = :B), '★ מייל שעוד ממתין לכתובת הזו — בוטל');
select assert_true((select status = 'queued' from email_messages where student_id = :C), '...ומייל לכתובת אחרת — ממתין כרגיל');
set local role anon;
select assert_true((rpc_email_unsubscribe(:'tok', true) ->> 'unsubscribed')::boolean, 'לחיצה שנייה — עדיין "הוסרה", בלי שגיאה');
reset role;
select assert_eq((select count(*) from audit_log where action = 'email_unsubscribe'), 1, 'נרשם פעם אחת ביומן');
rollback;
\echo '  כל בדיקות המיילים להורים עברו'
