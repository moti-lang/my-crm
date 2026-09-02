-- מקומי בלבד — תחליף ל-scripts/seed-users.mjs עבור פוסטגרס בלי GoTrue.
-- מייצר את אותם שלושה משתמשים עם אותם UUID קבועים, כדי שהבדיקות יהיו דטרמיניסטיות.
-- בענן זה לא רץ: שם ה-Admin API יוצר את המשתמשים (גם ב-auth.identities).
-- כל שינוי כאן חייב להישאר תואם ל-scripts/seed-users.mjs.

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001','hania@teichtal.local'),
  ('cccccccc-0000-0000-0000-000000000002','beitar@teichtal.local'),
  ('cccccccc-0000-0000-0000-000000000003','books@teichtal.local')
on conflict (id) do nothing;

insert into profiles (id, full_name, phone, role) values
  ('cccccccc-0000-0000-0000-000000000001','הניה טייכטל','972501234567','owner'),
  ('cccccccc-0000-0000-0000-000000000002','רבקי פרידמן','972521111111','branch_manager'),
  ('cccccccc-0000-0000-0000-000000000003','שרה לוי','972533333333','accountant')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

-- רבקי מנהלת את ביתר עילית בלבד — הבסיס לכל בדיקות ה-RLS.
insert into branch_staff (branch_id, user_id)
select b.id, 'cccccccc-0000-0000-0000-000000000002'
from branches b where b.name = 'ביתר עילית'
on conflict do nothing;

update ledger_entries set created_by = 'cccccccc-0000-0000-0000-000000000001' where created_by is null;
