-- מקומי בלבד — זהויות הבדיקה, היכן שאין GoTrue.
--
-- אותו מסלול בדיוק שעוברת כניסה אמיתית: קודם שורה ברשימת המורשים,
-- ואז שורה ב-auth.users עם ספק google. את הפרופיל, התפקיד והשיוך
-- לסניף יוצר הטריגר f_auth_user_gate — לא הקובץ הזה. אם הטריגר
-- נשבר, שום זהות לא נוצרת וכל החבילה נופלת מיד.
--
-- UUID קבועים כדי שהבדיקות יהיו דטרמיניסטיות. בענן GoTrue מייצר
-- אחרים, ולכן הבדיקות פותרות זהות לפי תפקיד (t_user) ולא לפי UUID.
-- הגרסה לענן: scripts/seed-identities.mjs. שינוי כאן — לשנות בשניהם.

insert into allowed_users (email, full_name, role, branch_id) values
  ('hania@teichtal.local',  'הניה טייכטל', 'owner',          null),
  ('beitar@teichtal.local', 'רבקי פרידמן',  'branch_manager', (select id from branches where name = 'ביתר עילית')),
  ('books@teichtal.local',  'שרה לוי',      'accountant',     null)
on conflict (email) do nothing;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000001','hania@teichtal.local',  '{"provider":"google","providers":["google"]}', '{"full_name":"הניה טייכטל"}'),
  ('cccccccc-0000-0000-0000-000000000002','beitar@teichtal.local', '{"provider":"google","providers":["google"]}', '{"full_name":"רבקי פרידמן"}'),
  ('cccccccc-0000-0000-0000-000000000003','books@teichtal.local',  '{"provider":"google","providers":["google"]}', '{"full_name":"שרה לוי"}')
on conflict (id) do nothing;

-- טלפונים לזהויות הבדיקה (הפרופיל עצמו נוצר בטריגר).
update profiles set phone = '972501234567' where email = 'hania@teichtal.local';
update profiles set phone = '972521111111' where email = 'beitar@teichtal.local';
update profiles set phone = '972533333333' where email = 'books@teichtal.local';

update ledger_entries set created_by = 'cccccccc-0000-0000-0000-000000000001' where created_by is null;
