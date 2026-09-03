-- 0014_google_allowlist.sql — כניסה בגוגל בלבד, לפי רשימת מורשים.
--
-- המודל: אין הרשמה. הבעלים מזמין לפי אימייל, ורק אימייל שברשימה
-- מקבל חשבון. החסימה אינה במסך — היא בטריגר על auth.users, שמפיל את
-- יצירת החשבון עצמה. מי שאינו ברשימה לא מקבל שורה ב-auth.users, ולכן
-- אין לו JWT ואין לו מה להראות ל-RLS.
--
-- שלוש שכבות, כל אחת עומדת לבדה:
--   1. f_auth_user_gate  — טריגר על auth.users: לא ברשימה, או לא גוגל → חריגה.
--   2. profiles          — נוצר רק על ידי הטריגר, ורק למורשה. auth_role()
--                          מחזירה תפקיד רק לפרופיל פעיל; מושבת = null = כלום.
--   3. allowed_users     — מקור האמת. שינוי תפקיד/סניף/השבתה מסונכרן
--                          לפרופיל ול-branch_staff בטריגר, לא בקוד לקוח.
--
-- מוזמנת שטרם נכנסה: שורה ב-allowed_users בלי user_id ("ממתינה").
-- כשהיא נכנסת בגוגל עם אותו אימייל, הטריגר מצמיד לה את התפקיד שחיכה לה.

-- ─────────────────────────── profiles.email ───────────────────────────
-- הקישור בין ההזמנה לחשבון הוא האימייל. הוא נשמר בפרופיל כדי שאף
-- פונקציה לא תצטרך לקרוא מ-auth.users (ה-shim המקומי מפושט ממנה).
alter table profiles add column email text unique;

-- ─────────────────────────── allowed_users ───────────────────────────
create table allowed_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique
              check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name   text not null default '',
  role        user_role not null default 'branch_manager',
  -- למנהלת סניף: הסניף שלה. לשאר התפקידים אין משמעות.
  branch_id   uuid references branches(id) on delete set null,
  is_active   boolean not null default true,
  -- null = ממתינה: הוזמנה ועדיין לא נכנסה בגוגל.
  user_id     uuid unique references profiles(id) on delete set null,
  invited_by  uuid references profiles(id) on delete set null,
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  updated_at  timestamptz not null default now()
);

alter table allowed_users enable row level security;
-- בסופבייס ברירת המחדל מעניקה ל-anon הרשאות על כל טבלה חדשה.
revoke all on allowed_users from anon, public;
grant select, insert, update, delete on allowed_users to authenticated;

create policy allowed_users_owner on allowed_users for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
create policy allowed_users_self on allowed_users for select
  using (user_id = auth.uid());

-- ─────────── סנכרון הזמנה → פרופיל (הפונקציה הפנימית) ───────────
-- כל מה שהבעלים משנה ברשימה מגיע לפרופיל ול-branch_staff מכאן.
-- security definer: הטריגר רץ גם בהקשר של GoTrue (supabase_auth_admin),
-- שאין לו הרשאות על public.
create or replace function f_allowlist_apply(p allowed_users) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p.user_id is null then return; end if;

  update profiles
     set role      = p.role,
         is_active = p.is_active,
         full_name = case when p.full_name <> '' then p.full_name else full_name end
   where id = p.user_id;

  -- השיוך לסניף נגזר מהרשימה בלבד. מנהלת שהועברה לסניף אחר מאבדת
  -- את הקודם; מי שאינה מנהלת סניף אינה משויכת לכלום.
  delete from branch_staff where user_id = p.user_id;
  if p.is_active and p.role = 'branch_manager' and p.branch_id is not null then
    insert into branch_staff (branch_id, user_id) values (p.branch_id, p.user_id);
  end if;
end $$;
revoke all on function f_allowlist_apply(allowed_users) from public, anon, authenticated;

-- ─────────── הטריגר על auth.users: השער ───────────
create or replace function f_auth_user_gate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email    text := lower(btrim(coalesce(new.email, '')));
  v_provider text := new.raw_app_meta_data ->> 'provider';
  v_allowed  allowed_users;
  v_name     text;
begin
  -- גוגל בלבד. סיסמה, קישור קסם, ספק אחר — אין חשבון.
  if v_provider is distinct from 'google' then
    raise exception 'ALLOWLIST: כניסה בגוגל בלבד (התקבל: %)', coalesce(v_provider, 'ללא ספק')
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_allowed from allowed_users where email = v_email and is_active;
  if v_allowed.id is null then
    raise exception 'ALLOWLIST: % אינו ברשימת המורשים', v_email
      using errcode = 'insufficient_privilege';
  end if;
  if v_allowed.user_id is not null and v_allowed.user_id <> new.id then
    raise exception 'ALLOWLIST: % כבר מקושר לחשבון אחר', v_email
      using errcode = 'insufficient_privilege';
  end if;

  v_name := coalesce(nullif(v_allowed.full_name, ''),
                     nullif(new.raw_user_meta_data ->> 'full_name', ''),
                     nullif(new.raw_user_meta_data ->> 'name', ''),
                     v_email);

  insert into profiles (id, email, full_name, role, is_active)
  values (new.id, v_email, v_name, v_allowed.role, true);

  update allowed_users
     set user_id = new.id, joined_at = coalesce(joined_at, now()), updated_at = now()
   where id = v_allowed.id
   returning * into v_allowed;

  perform f_allowlist_apply(v_allowed);
  return new;
end $$;
revoke all on function f_auth_user_gate() from public, anon, authenticated;

-- GoTrue מריץ את ההוספה בתור supabase_auth_admin. מקומית התפקיד לא קיים.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function f_auth_user_gate() to supabase_auth_admin;
    grant execute on function f_allowlist_apply(allowed_users) to supabase_auth_admin;
  end if;
end $$;

drop trigger if exists auth_user_gate on auth.users;
create trigger auth_user_gate
  after insert on auth.users
  for each row execute function f_auth_user_gate();

-- ─────────── טריגרים על allowed_users ───────────
-- לפני כתיבה: נרמול, קישור לחשבון קיים, ונעילת הבעלים האחרון.
create or replace function f_allowlist_before() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing uuid; v_owners int;
begin
  new.email := lower(btrim(new.email));
  new.updated_at := now();

  if tg_op = 'UPDATE' and old.user_id is not null and new.email <> old.email then
    raise exception 'ALLOWLIST: אי אפשר לשנות אימייל של משתמשת שכבר נכנסה';
  end if;
  -- הקישור לחשבון נקבע רק בטריגרים, לא ביד.
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id and new.user_id is not null then
    new.user_id := old.user_id;
  end if;

  -- הזמנה מחדש של מי שכבר יש לה חשבון (הוסרה ואז הוחזרה): מקשרים.
  if new.user_id is null then
    select id into v_existing from profiles where email = new.email;
    if v_existing is not null then
      new.user_id := v_existing;
      new.joined_at := coalesce(new.joined_at, now());
    end if;
  end if;

  -- הבעלים הפעילה האחרונה לא מושבתת ולא מורידה את עצמה: אחרת אין מי
  -- שיזמין. נספרות רק בעלים שכבר נכנסו — הזמנה ממתינה אינה ערובה.
  if tg_op = 'UPDATE' and old.role = 'owner' and old.is_active
     and (not new.is_active or new.role <> 'owner') then
    select count(*) into v_owners from allowed_users
     where role = 'owner' and is_active and user_id is not null and id <> old.id;
    if v_owners = 0 then
      raise exception 'ALLOWLIST: זו הבעלים הפעילה האחרונה — אי אפשר להשבית או לשנות את תפקידה';
    end if;
  end if;
  return new;
end $$;
revoke all on function f_allowlist_before() from public, anon, authenticated;

create or replace function f_allowlist_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owners int;
begin
  if tg_op = 'DELETE' then
    if old.role = 'owner' and old.is_active then
      select count(*) into v_owners from allowed_users
       where role = 'owner' and is_active and user_id is not null;
      if v_owners = 0 then
        raise exception 'ALLOWLIST: זו הבעלים הפעילה האחרונה — אי אפשר להסיר';
      end if;
    end if;
    -- הסרה מהרשימה = הפרופיל נשאר (יש עליו רשומות) אבל כבוי. auth_role()
    -- מחזירה null, וכל פוליסה במערכת סוגרת את הדלת.
    if old.user_id is not null then
      update profiles set is_active = false where id = old.user_id;
      delete from branch_staff where user_id = old.user_id;
    end if;
    return old;
  end if;
  perform f_allowlist_apply(new);
  return new;
end $$;
revoke all on function f_allowlist_after() from public, anon, authenticated;

create trigger allowed_users_before
  before insert or update on allowed_users
  for each row execute function f_allowlist_before();
create trigger allowed_users_after
  after insert or update or delete on allowed_users
  for each row execute function f_allowlist_after();

-- ─────────── ניקוי משתמשי הסיסמה הישנים ───────────
-- שלושת משתמשי ה-seed (@teichtal.local) נכנסו בסיסמה שכתובה בגיט.
-- הם נמחקים כאן, כולל מה שמצביע עליהם (created_by וכדומה מתאפס —
-- הרשומות עצמן נשארות). ריצה חוזרת: אין מה למחוק, אין שגיאה.
do $$
declare v_ids uuid[]; c record;
begin
  select array_agg(id) into v_ids from profiles
   where id in (select id from auth.users where email like '%@teichtal.local');
  if v_ids is null then return; end if;

  for c in
    select t.relname as tbl, a.attname as col
    from pg_constraint k
    join pg_class t on t.oid = k.conrelid
    join pg_class f on f.oid = k.confrelid and f.relname = 'profiles'
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
    where k.contype = 'f' and k.confdeltype <> 'c'
  loop
    execute format('update public.%I set %I = null where %I = any($1)', c.tbl, c.col, c.col) using v_ids;
  end loop;

  delete from auth.users where id = any(v_ids);
end $$;
