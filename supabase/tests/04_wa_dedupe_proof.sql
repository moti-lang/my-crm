-- 04_wa_dedupe_proof.sql — מניעת כפילויות בהודעות וואטסאפ.
-- התרחיש שנבדק: השרת העצמאי מתאושש מריסטארט ושולח שוב את אותה הודעה.
-- אם היא נכנסת פעמיים ומדובר בפקודה כספית, ההוצאה נרשמת פעמיים.

\set ON_ERROR_STOP on

\ir _assert.sql

begin;

-- ═════════ אותו מזהה פעמיים ═════════
insert into wa_messages (direction, phone, body, status, provider_msg_id)
values ('in','972521000001','שילמתי 860 תלבושות בביתר','queued','MSG-ABC-001');

-- הראיה היא שמספר השורות נשאר 1, לא איזה SQLSTATE נזרק:
-- אילו אינדקס ייחודי אחר היה נופל, תפיסת unique_violation הייתה
-- מדווחת ✓ בטעות.
select assert_no_effect(
  'הודעה חוזרת עם אותו מזהה',
  $a$insert into wa_messages (direction, phone, body, status, provider_msg_id)
     values ('in','972521000001','שילמתי 860 תלבושות בביתר','queued','MSG-ABC-001')$a$,
  $p$select count(*)::text from public.wa_messages where provider_msg_id = 'MSG-ABC-001'$p$);

-- הדפוס שה-webhook משתמש בו: on conflict do nothing, בלי שגיאה
insert into wa_messages (direction, phone, body, status, provider_msg_id)
values ('in','972521000001','שילמתי 860 תלבושות בביתר','queued','MSG-ABC-001')
on conflict (provider_msg_id) where provider_msg_id is not null do nothing;

select assert_eq((select count(*) from wa_messages where provider_msg_id = 'MSG-ABC-001'), 1,
                 '★ אחרי שלוש כניסות של אותו מזהה — שורה אחת בלבד');

-- ═════════ הודעות בלי מזהה (הרצה יבשה) ═════════
insert into wa_messages (direction, phone, body, status) values
  ('out','972521000002','תזכורת א','queued'),
  ('out','972521000002','תזכורת ב','queued'),
  ('out','972521000002','תזכורת ג','queued');
select assert_eq((select count(*) from wa_messages where provider_msg_id is null), 3,
                 'הודעות ללא מזהה אינן מתנגשות זו בזו');

-- ═════════ מזהים שונים עוברים ═════════
insert into wa_messages (direction, phone, body, status, provider_msg_id) values
  ('in','972521000003','שאלה','queued','MSG-ABC-002'),
  ('in','972521000004','שאלה אחרת','queued','MSG-ABC-003');
select assert_eq((select count(*) from wa_messages where provider_msg_id like 'MSG-ABC-%'), 3,
                 'מזהים שונים נכנסים כרגיל');

-- ═════════ כפילות בתוך אותה פקודת INSERT ═════════
select assert_no_effect(
  'כפילות בתוך אותה פקודה',
  $a$insert into wa_messages (direction, phone, body, status, provider_msg_id) values
      ('in','972521000005','כפול','queued','MSG-DUP'),
      ('in','972521000005','כפול','queued','MSG-DUP')$a$,
  $p$select count(*)::text from public.wa_messages where provider_msg_id = 'MSG-DUP'$p$);

rollback;

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות מניעת הכפילויות עברו'
\echo '─────────────────────────────────────────'
