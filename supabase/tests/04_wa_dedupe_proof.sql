-- 04_wa_dedupe_proof.sql — מניעת כפילויות בהודעות וואטסאפ.
-- התרחיש שנבדק: השרת העצמאי מתאושש מריסטארט ושולח שוב את אותה הודעה.
-- אם היא נכנסת פעמיים ומדובר בפקודה כספית, ההוצאה נרשמת פעמיים.

\set ON_ERROR_STOP on

create or replace function assert_eq(actual bigint, expected bigint, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception E'\n  ✗ %\n    התקבל: %   ציפינו: %', label, actual, expected;
  end if;
  raise notice '  ✓ % (%)', label, actual;
end $$;

begin;

-- ═════════ אותו מזהה פעמיים ═════════
insert into wa_messages (direction, phone, body, status, provider_msg_id)
values ('in','972521000001','שילמתי 860 תלבושות בביתר','queued','MSG-ABC-001');

do $$ begin
  insert into wa_messages (direction, phone, body, status, provider_msg_id)
  values ('in','972521000001','שילמתי 860 תלבושות בביתר','queued','MSG-ABC-001');
  raise exception E'\n  ✗ ★ כפילות! אותו provider_msg_id נכנס פעמיים';
exception when unique_violation then
  raise notice '  ✓ ★ הודעה חוזרת עם אותו מזהה נחסמה ע"י המסד';
end $$;

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
do $$ begin
  insert into wa_messages (direction, phone, body, status, provider_msg_id) values
    ('in','972521000005','כפול','queued','MSG-DUP'),
    ('in','972521000005','כפול','queued','MSG-DUP');
  raise exception E'\n  ✗ ★ כפילות בתוך אותה פקודה לא נחסמה';
exception when unique_violation then
  raise notice '  ✓ ★ כפילות בתוך אותה פקודה נחסמה';
end $$;

rollback;

drop function assert_eq(bigint, bigint, text);
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות מניעת הכפילויות עברו'
\echo '─────────────────────────────────────────'
