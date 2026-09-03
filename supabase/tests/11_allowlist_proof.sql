-- 11_allowlist_proof.sql — הוכחת רשימת המורשים. החסימה במסד, לא במסך.
--
-- מה שנבדק כאן הוא הדלת עצמה: יצירת חשבון ב-auth.users. אימייל שאינו
-- ברשימה, או שאינו מגיע מגוגל, לא מקבל שורה — ולכן אין לו JWT ואין לו
-- מה להראות ל-RLS. ובנוסף: גם מי שיש לו JWT תקין אבל אין לו פרופיל
-- פעיל מקבל אפס שורות מכל טבלה ב-public, בלולאה על כולן.

\set ON_ERROR_STOP on
\set BEITAR   '''bbbbbbbb-0000-0000-0000-000000000001'''
\set MODIIN   '''bbbbbbbb-0000-0000-0000-000000000002'''
\set GOOGLE   '''{"provider":"google","providers":["google"]}'''
\set PASSWORD '''{"provider":"email","providers":["email"]}'''

\ir _assert.sql

-- ═════════════ 1. הדלת: יצירת חשבון ═════════════
-- הבדיקה מזמינה אימייל משלה. היא אינה תלויה במצב הבעלים מה-seed —
-- בענן היא כבר נכנסה, מקומית היא ממתינה, ושניהם תקינים.
\echo 'השער על auth.users:'
begin;
insert into allowed_users (email, role) values ('gate.probe@gmail.com', 'accountant');

select assert_no_effect(
  '★ אימייל שאינו ברשימה — אין חשבון, אין פרופיל',
  $a$insert into auth.users (email, raw_app_meta_data)
     values ('stranger@gmail.com', '{"provider":"google","providers":["google"]}')$a$,
  $p$select (select count(*) from auth.users)::text || '/' || (select count(*) from public.profiles)$p$);

select assert_no_effect(
  '★ אימייל ברשימה אבל בסיסמה (ספק email) — אין חשבון',
  $a$insert into auth.users (email, raw_app_meta_data)
     values ('gate.probe@gmail.com', '{"provider":"email","providers":["email"]}')$a$,
  $p$select (select count(*) from auth.users)::text || '/' || (select count(*) from public.profiles)$p$);

select assert_no_effect(
  '★ אימייל ברשימה בלי ספק כלל (Admin API ישן) — אין חשבון',
  $a$insert into auth.users (email) values ('gate.probe@gmail.com')$a$,
  $p$select (select count(*) from auth.users)::text$p$);

update allowed_users set is_active = false where email = 'gate.probe@gmail.com';
select assert_no_effect(
  '★ אימייל ברשימה אבל מושבת — אין חשבון',
  $a$insert into auth.users (email, raw_app_meta_data)
     values ('gate.probe@gmail.com', '{"provider":"google","providers":["google"]}')$a$,
  $p$select (select count(*) from auth.users)::text$p$);
rollback;

-- ═════════════ 2. הזמנה ממתינה → כניסה ראשונה ═════════════
\echo 'הזמנה ממתינה:'
begin;
-- הבעלים מזמינה מנהלת סניף חדשה למודיעין. השם ריק — יילקח מגוגל.
insert into allowed_users (email, full_name, role, branch_id)
values ('  New.Manager@Gmail.com ', '', 'branch_manager', :MODIIN);
select assert_true((select email = 'new.manager@gmail.com' from allowed_users where email like 'new.manager%'),
                   'האימייל מנורמל: אותיות קטנות, בלי רווחים');
select assert_true((select user_id is null and joined_at is null from allowed_users where email = 'new.manager@gmail.com'),
                   'לפני הכניסה: ממתינה, בלי חשבון');

-- הכניסה הראשונה בגוגל, עם אותו אימייל (באותיות גדולות — גוגל לא מבטיח)
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('dddddddd-0000-0000-0000-000000000001', 'New.Manager@gmail.com', :GOOGLE, '{"full_name":"חני מנהלת"}');

select assert_true((select role = 'branch_manager' and is_active from profiles
                     where id = 'dddddddd-0000-0000-0000-000000000001'),
                   '★ הפרופיל נוצר אוטומטית עם התפקיד שחיכה לה');
select assert_true((select full_name = 'חני מנהלת' from profiles
                     where id = 'dddddddd-0000-0000-0000-000000000001'),
                   'השם נלקח מגוגל כשההזמנה בלי שם');
select assert_true((select email = 'new.manager@gmail.com' from profiles
                     where id = 'dddddddd-0000-0000-0000-000000000001'),
                   'האימייל בפרופיל מנורמל');
select assert_true((select user_id = 'dddddddd-0000-0000-0000-000000000001' and joined_at is not null
                     from allowed_users where email = 'new.manager@gmail.com'),
                   '★ ההזמנה מקושרת לחשבון — כבר לא ממתינה');
select assert_eq((select count(*) from branch_staff
                   where user_id = 'dddddddd-0000-0000-0000-000000000001' and branch_id = :MODIIN), 1,
                 '★ השיוך לסניף שנקבע בהזמנה נוצר אוטומטית');

-- ואותו חשבון, מול RLS, רואה בדיוק את הסניף שלה
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000001","role":"authenticated"}', true);
select assert_true(auth_role() = 'branch_manager', 'auth_role של המוזמנת: branch_manager');
select assert_eq((select count(*) from branches), 1, '★ המוזמנת רואה סניף אחד');
select assert_eq((select count(*) from branches where id = :MODIIN), 1, 'והוא מודיעין');
select assert_eq((select count(*) from allowed_users), 1, 'ברשימת המורשים היא רואה רק את עצמה');
select assert_no_effect(
  'מנהלת אינה מזמינה אף אחת',
  $a$insert into allowed_users (email, role) values ('friend@gmail.com', 'owner')$a$,
  $p$select count(*)::text from public.allowed_users$p$);
select assert_no_effect(
  'מנהלת אינה משנה את התפקיד של עצמה ברשימה',
  $a$update allowed_users set role = 'owner' where user_id = auth.uid()$a$,
  $p$select role::text from public.allowed_users where email = 'new.manager@gmail.com'$p$);
rollback;

-- ═════════════ 3. שינוי תפקיד וסניף מסונכרן ═════════════
\echo 'סנכרון הרשימה → פרופיל:'
begin;
-- רבקי: מנהלת ביתר עילית. הבעלים מעבירה אותה למודיעין.
update allowed_users set branch_id = :MODIIN where email = 'beitar@teichtal.local';
select assert_eq((select count(*) from branch_staff
                   where user_id = t_user('branch_manager'::user_role) and branch_id = :BEITAR), 0,
                 '★ השיוך הישן נמחק');
select assert_eq((select count(*) from branch_staff
                   where user_id = t_user('branch_manager'::user_role) and branch_id = :MODIIN), 1,
                 '★ השיוך החדש נוצר');

-- ואז הופכת אותה לרואת חשבון: אין יותר שיוך לסניף
update allowed_users set role = 'accountant' where email = 'beitar@teichtal.local';
select assert_true((select role = 'accountant' from profiles where email = 'beitar@teichtal.local'),
                   '★ התפקיד בפרופיל השתנה');
select assert_eq((select count(*) from branch_staff where user_id =
                   (select user_id from allowed_users where email = 'beitar@teichtal.local')), 0,
                 'רואת חשבון אינה משויכת לסניף');

-- שם שנקבע בהזמנה גובר על השם מגוגל
update allowed_users set full_name = 'רבקה פרידמן' where email = 'beitar@teichtal.local';
select assert_true((select full_name = 'רבקה פרידמן' from profiles where email = 'beitar@teichtal.local'),
                   'שם שהבעלים קבעה מתעדכן בפרופיל');

-- הקישור לחשבון אינו ניתן לזיוף ביד
update allowed_users set user_id = t_user('owner'::user_role) where email = 'books@teichtal.local';
select assert_true((select user_id = 'cccccccc-0000-0000-0000-000000000003' from allowed_users where email = 'books@teichtal.local'),
                   '★ user_id נקבע רק בטריגר — עדכון ידני מתעלם');
select assert_no_effect(
  '★ אימייל של מי שכבר נכנסה אינו ניתן לשינוי',
  $a$update allowed_users set email = 'other@gmail.com' where email = 'books@teichtal.local'$a$,
  $p$select email from public.allowed_users where user_id = 'cccccccc-0000-0000-0000-000000000003'$p$);

-- הפונקציה הפנימית, ישירות: מיישמת את הרשימה על הפרופיל
update profiles set role = 'owner' where email = 'books@teichtal.local';
select f_allowlist_apply(a) from allowed_users a where a.email = 'books@teichtal.local';
select assert_true((select role = 'accountant' from profiles where email = 'books@teichtal.local'),
                   'f_allowlist_apply מחזירה את הפרופיל למה שברשימה');
rollback;

-- ═════════════ 4. השבתה והסרה — הדלת נסגרת ═════════════
\echo 'השבתה והסרה:'
-- ה-sub נקבע במפורש ולא דרך t_user: t_user מסננת פרופילים פעילים, ואחרי
-- ההשבתה הייתה מחזירה null — ואז auth_role() "עוברת" מהסיבה הלא נכונה.
begin;
update allowed_users set is_active = false where email = 'beitar@teichtal.local';
select assert_true((select not is_active from profiles where email = 'beitar@teichtal.local'),
                   '★ השבתה ברשימה מכבה את הפרופיל');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);
select assert_true(auth_role() is null, '★ auth_role של מושבתת: null');
select assert_eq((select count(*) from branches), 0, '★ מושבתת אינה רואה סניפים');
select assert_eq((select count(*) from students), 0, '★ מושבתת אינה רואה תלמידות');
select assert_no_effect(
  '★ מושבתת אינה כותבת',
  $a$insert into students (season_id, branch_id, full_name)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'חדירה')$a$,
  $p$select count(*)::text from public.students$p$);
rollback;

begin;
delete from allowed_users where email = 'beitar@teichtal.local';
select assert_true((select not is_active from profiles where email = 'beitar@teichtal.local'),
                   '★ הסרה מהרשימה מכבה את הפרופיל (הרשומות שלה נשארות)');
select assert_eq((select count(*) from branch_staff
                   where user_id = 'cccccccc-0000-0000-0000-000000000002'), 0,
                 'השיוך לסניף נמחק');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000002","role":"authenticated"}', true);
select assert_true(auth_role() is null, '★ auth_role של מי שהוסרה: null');
select assert_eq((select count(*) from students), 0, '★ מי שהוסרה אינה רואה תלמידות');
reset role;
-- הזמנה מחדש של אותו אימייל: מתקשרת לחשבון הקיים ומדליקה אותו
insert into allowed_users (email, role, branch_id) values ('beitar@teichtal.local', 'branch_manager', :BEITAR);
select assert_true((select user_id = 'cccccccc-0000-0000-0000-000000000002' and joined_at is not null
                     from allowed_users where email = 'beitar@teichtal.local'),
                   '★ הזמנה מחדש מתקשרת לחשבון הקיים');
select assert_true((select is_active and role = 'branch_manager' from profiles
                     where id = 'cccccccc-0000-0000-0000-000000000002'),
                   '★ הפרופיל חוזר לפעול');
select assert_eq((select count(*) from branch_staff
                   where user_id = 'cccccccc-0000-0000-0000-000000000002' and branch_id = :BEITAR), 1,
                 'והשיוך לסניף חוזר');
rollback;

-- ═════════════ 5. הבעלים האחרונה נעולה ═════════════
-- מצב הפתיחה נבנה כאן ולא מונח: כל בעלים אחרת מושבתת (מותר, כי הניה
-- נשארת), ואז הניה היא היחידה שנכנסה.
\echo 'נעילת הבעלים האחרונה:'
begin;
update allowed_users set is_active = false where role = 'owner' and email <> 'hania@teichtal.local';
select assert_eq((select count(*) from allowed_users where role = 'owner' and is_active and user_id is not null), 1,
                 'נקודת פתיחה: בעלים אחת שנכנסה');
insert into allowed_users (email, role) values ('pending.owner@gmail.com', 'owner');

select assert_no_effect(
  '★ הבעלים היחידה שנכנסה אינה מושבתת (ממתינה אינה נספרת)',
  $a$update allowed_users set is_active = false where email = 'hania@teichtal.local'$a$,
  $p$select is_active::text from public.allowed_users where email = 'hania@teichtal.local'$p$);
select assert_no_effect(
  '★ ואינה מורידה את עצמה לתפקיד אחר',
  $a$update allowed_users set role = 'accountant' where email = 'hania@teichtal.local'$a$,
  $p$select role::text from public.allowed_users where email = 'hania@teichtal.local'$p$);
select assert_no_effect(
  '★ ואינה מוסרת',
  $a$delete from allowed_users where email = 'hania@teichtal.local'$a$,
  $p$select count(*)::text from public.allowed_users where email = 'hania@teichtal.local'$p$);

-- הזמנה ממתינה של בעלים כן ניתנת להסרה כשיש בעלים שנכנסה
delete from allowed_users where email = 'pending.owner@gmail.com';
select assert_eq((select count(*) from allowed_users where email = 'pending.owner@gmail.com'), 0,
                 'הזמנה ממתינה ניתנת להסרה כשיש בעלים פעילה אחרת');

-- וכשבעלים שנייה נכנסת — הראשונה משתחררת
insert into allowed_users (email, role) values ('second.owner@gmail.com', 'owner');
insert into auth.users (id, email, raw_app_meta_data)
values ('dddddddd-0000-0000-0000-000000000002', 'second.owner@gmail.com', :GOOGLE);
update allowed_users set is_active = false where email = 'hania@teichtal.local';
select assert_true((select not is_active from allowed_users where email = 'hania@teichtal.local'),
                   'עם בעלים שנייה שנכנסה, הראשונה ניתנת להשבתה');
rollback;

-- ═════════════ 6. JWT תקין בלי פרופיל: אפס בכל טבלה ═════════════
-- זה המקרה של חשבון שנוצר בדרך אחרת, או פרופיל שנמחק. בלולאה על כל
-- הטבלאות ב-public — טבלה חדשה במיגרציה עתידית נבדקת אוטומטית.
\echo 'JWT בלי פרופיל:'
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-000000000000","role":"authenticated"}', true);
do $$
declare t record; n bigint; checked int := 0;
begin
  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', t.tablename) into n;
    if n <> 0 then
      raise exception E'\n  ✗ ★ JWT בלי פרופיל קורא % שורות מ-%', n, t.tablename;
    end if;
    checked := checked + 1;
  end loop;
  if checked < 10 then raise exception E'\n  ✗ הלולאה עברה על % טבלאות בלבד', checked; end if;
  raise notice '  ✓ ★ JWT תקין בלי פרופיל: אפס שורות בכל % הטבלאות ב-public', checked;
end $$;
select assert_no_effect(
  '★ ואינו כותב לרשימת המורשים',
  $a$insert into allowed_users (email, role) values ('me@gmail.com', 'owner')$a$,
  $p$select count(*)::text from public.allowed_users$p$);
select assert_no_effect(
  '★ ואינו יוצר לעצמו פרופיל',
  $a$insert into profiles (id, full_name, role) values (auth.uid(), 'אני', 'owner')$a$,
  $p$select count(*)::text from public.profiles$p$);
rollback;

-- ═════════════ 7. הבעלים רואה ומנהלת את הרשימה ═════════════
\echo 'הבעלים:'
begin;
set local role authenticated;
select set_config('request.jwt.claims', t_claims('owner'::user_role), true);
select assert_true((select count(*) from allowed_users) >= 4, 'הבעלים רואה את כל הרשימה (לפחות 3 זהויות + הבעלים מה-seed)');
insert into allowed_users (email, full_name, role, branch_id, invited_by)
values ('invited@gmail.com', 'מוזמנת', 'branch_manager', :BEITAR, auth.uid());
select assert_eq((select count(*) from allowed_users where email = 'invited@gmail.com' and user_id is null), 1,
                 '★ הבעלים מזמינה — השורה נוצרת כממתינה');
update allowed_users set role = 'accountant' where email = 'invited@gmail.com';
select assert_true((select role = 'accountant' from allowed_users where email = 'invited@gmail.com'),
                   'הבעלים משנה תפקיד להזמנה');
delete from allowed_users where email = 'invited@gmail.com';
select assert_eq((select count(*) from allowed_users where email = 'invited@gmail.com'), 0,
                 'הבעלים מסירה הזמנה');
rollback;

select drop_assert_helpers();
\echo '─────────────────────────────────────────'
\echo ' כל בדיקות רשימת המורשים עברו'
\echo '─────────────────────────────────────────'
