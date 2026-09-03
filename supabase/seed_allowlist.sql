-- seed_allowlist.sql — הבעלים הראשונה. בלעדיה אין מי שיכנס ואין מי שיזמין.
--
-- נפרד מ-seed.sql בכוונה: seed.sql רץ פעם אחת על מסד ריק (מזהים קבועים),
-- ואילו הקובץ הזה אידמפוטנטי ורץ בכל פריסה ובכל סבב אימות. אם השורה
-- כבר קיימת — היא מוודאת שהיא עדיין בעלים ופעילה.
--
-- השם נשאר ריק: בכניסה הראשונה הוא נלקח מחשבון הגוגל.
insert into allowed_users (email, full_name, role)
values ('moti@automation1.co.il', '', 'owner')
on conflict (email) do update set role = 'owner', is_active = true;
