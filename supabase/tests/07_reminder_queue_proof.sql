-- 07_reminder_queue_proof.sql — תור התזכורות.
--
-- מה שנבדק כאן מגיע להורים בוואטסאפ. באג כאן אינו מספר שגוי במסך —
-- הוא הודעה חוזרת כל בוקר לאותה משפחה.

\set ON_ERROR_STOP on
\ir _assert.sql
\set SEASON '''aaaaaaaa-0000-0000-0000-000000000001'''

begin;

-- ═════════ פעם אחת לכל סף ═════════
-- cron-debt רץ כל יום. בלי מפתח ייחודיות, תלמידה עם חוב מקבלת
-- את אותה הודעה כל בוקר מחדש.
insert into reminders (kind, student_id, to_phone, to_label, body, scheduled_at, dedupe_key)
values ('debt','dddddddd-0000-0000-0000-000000000003','972521000003','מירי · אסתי',
        'תזכורת', now(), 'debt:dddddddd-0000-0000-0000-000000000003:60:never');

select assert_no_effect(
  'הרצה חוזרת של cron-debt באותו יום',
  $a$insert into reminders (kind, student_id, to_phone, to_label, body, scheduled_at, dedupe_key)
     values ('debt','dddddddd-0000-0000-0000-000000000003','972521000003','מירי · אסתי',
             'תזכורת', now(), 'debt:dddddddd-0000-0000-0000-000000000003:60:never')$a$,
  $p$select count(*)::text from public.reminders
      where dedupe_key = 'debt:dddddddd-0000-0000-0000-000000000003:60:never'$p$);

-- סף אחר לאותה תלמידה — כן נשלח
insert into reminders (kind, student_id, to_phone, to_label, body, scheduled_at, dedupe_key)
values ('debt','dddddddd-0000-0000-0000-000000000003','972521000003','מירי · אסתי',
        'תזכורת 90', now(), 'debt:dddddddd-0000-0000-0000-000000000003:90:never');
select assert_eq((select count(*) from reminders
                   where dedupe_key like 'debt:dddddddd-0000-0000-0000-000000000003:%'), 2,
                 'סף נוסף לאותה תלמידה כן נכנס לתור');

-- ★ אחרי תשלום — מחזור חוב חדש מקבל תזכורות חדשות
insert into reminders (kind, student_id, to_phone, to_label, body, scheduled_at, dedupe_key)
values ('debt','dddddddd-0000-0000-0000-000000000003','972521000003','מירי · אסתי',
        'תזכורת אחרי תשלום', now(), 'debt:dddddddd-0000-0000-0000-000000000003:60:2026-10-01');
select assert_eq((select count(*) from reminders
                   where dedupe_key like 'debt:dddddddd-0000-0000-0000-000000000003:%'), 3,
                 '★ תשלום מאפס את המונה — מחזור חוב חדש מקבל תזכורת');

-- תזכורות ידניות ללא מפתח אינן מתנגשות
insert into reminders (kind, to_phone, body, scheduled_at) values
  ('general','972521000001','הודעה א', now()),
  ('general','972521000001','הודעה ב', now()),
  ('general','972521000001','הודעה ג', now());
select assert_eq((select count(*) from reminders where dedupe_key is null and kind='general'), 3,
                 'תזכורות ידניות ללא מפתח אינן חוסמות זו את זו');

-- ═════════ סטטוסים ═════════
select assert_eq((select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
                   where t.typname='msg_status' and e.enumlabel in ('delivered','read')), 0,
                 '★ אין סטטוס "נמסר" — לשרת אין אירוע מסירה');

-- ═════════ רצף היעדרויות ═════════
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  t_claims('owner'::user_role), true);

select assert_eq((select count(*) from v_absence_streaks where absent_streak >= 3), 1,
                 'תלמידה אחת עם שלוש היעדרויות רצופות');
select assert_true((select full_name = 'ריקי לוינגר' from v_absence_streaks
                     where absent_streak >= 3), 'הזיהוי מצביע על התלמידה הנכונה');
select assert_eq((select absent_streak from v_absence_streaks where full_name='ריקי לוינגר'), 3,
                 'אורך הרצף מחושב נכון');

-- מנהלת סניף רואה רק את הסניף שלה גם כאן
select set_config('request.jwt.claims',
  t_claims('branch_manager'::user_role), true);
select assert_eq((select count(*) from v_absence_streaks
                   where branch_id <> 'bbbbbbbb-0000-0000-0000-000000000001'), 0,
                 '★ רצפי היעדרות של סניפים אחרים אינם נראים');
rollback;

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות תור התזכורות עברו'
\echo '─────────────────────────────────────────'
