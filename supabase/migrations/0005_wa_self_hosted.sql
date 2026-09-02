-- 0005 — מעבר משרת וואטסאפ מנוהל (Green API) לשרת עצמאי.
--
-- שלושה דברים שהשרת העצמאי מחייב ושלא היו נדרשים קודם:
--   1. מניעת כפילויות. שרת שמחזיק חיבור בעצמו שולח שוב אחרי ריסטארט.
--      כפילות בהודעה נכנסת שהיא פקודה כספית = הוצאה שנרשמת פעמיים.
--   2. מצב בריאות מתמשך, כי אין ספק שמנטר במקומנו.
--   3. ערוץ התראה חלופי — כשהוואטסאפ נופל אי אפשר להתריע בוואטסאפ.

-- ─────────── 1. מניעת כפילויות ───────────
-- green_id היה שם ספציפי לספק. provider_msg_id הוא המזהה של השרת שלנו.
alter table wa_messages rename column green_id to provider_msg_id;

-- הלב של המנגנון: אותו מזהה לא ייכנס פעמיים, גם אם שתי בקשות
-- מגיעות במקביל. האכיפה במסד ולא בקוד — קוד מפספס מרוצי תהליכים.
create unique index wa_messages_provider_msg_id_uniq
  on wa_messages (provider_msg_id)
  where provider_msg_id is not null;

-- ─────────── 2. התראות מערכת (הערוץ החלופי) ───────────
create table system_alerts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,              -- 'wa_down' | 'wa_recovered' | ...
  severity    text not null default 'warning',  -- 'info' | 'warning' | 'critical'
  title       text not null,
  body        text,
  meta        jsonb,
  acknowledged_at timestamptz,
  created_at  timestamptz not null default now()
);
create index system_alerts_open_idx on system_alerts (created_at desc)
  where acknowledged_at is null;

alter table system_alerts enable row level security;
revoke all on system_alerts from anon;
grant select, insert, update, delete on system_alerts to authenticated;

create policy alerts_owner on system_alerts for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
-- מנהלת סניף רואה התראות מערכת אבל לא מסמנת אותן כטופלו
create policy alerts_manager_read on system_alerts for select
  using (auth_role() = 'branch_manager');

-- ─────────── 3. מצב בריאות החיבור ───────────
insert into settings (key, value) values
  ('wa_health', '{"status":"unknown","checked_at":null,"last_ok_at":null,"consecutive_failures":0,"error":null}')
on conflict (key) do nothing;

-- כל משתמש מחובר צריך לקרוא את מצב הבריאות כדי להציג את האינדיקטור.
-- שאר ההגדרות נשארות לבעלים בלבד.
create policy settings_read_wa_health on settings for select
  using (key = 'wa_health' and auth_role() is not null);
