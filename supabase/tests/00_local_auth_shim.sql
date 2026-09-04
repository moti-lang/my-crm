-- שים (shim) מקומי בלבד: מחקה את מה ש-Supabase מספקת (סכמת auth + תפקידים).
-- לא חלק מהמיגרציות. משמש להרצת הסכמה, ה-seed והבדיקות על פוסטגרס מקומי.
-- ═══ מבנה הסכמות של סופבייס ═══
-- סופבייס מתקינה הרחבות בסכמת extensions, לא ב-public, ומוסיפה
-- אותה ל-search_path של המסד. shim שמתקין אותן ב-public מסתיר
-- כשלים אמיתיים: פונקציה security definer עם search_path נעול
-- ל-public לא תמצא את gen_random_bytes בענן, אבל כן תמצא מקומית.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;
-- אין כאן alter database ... set search_path. בכוונה.
-- פרויקט סופבייס חדש מתחיל עם search_path של "$user", public בלבד, ולסמוך
-- על כך ש-extensions נמצאת בנתיב זה הימור. השורה הזאת הייתה כאן והסתירה
-- באג אמיתי: אינדקס gin עם gin_trgm_ops לא מוסמך, שנפל על מסד טרי.
-- כל מיגרציה חייבת להסמיך בעצמה כל אובייקט מסכמת extensions.

create schema if not exists auth;

-- נאמן לעמודות של GoTrue: גיבוי מהענן חייב להשתחזר לכאן כמו שהוא
-- (restore-drill.sh). עמודה שחסרה כאן = שחזור שלא נבדק.
create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key default gen_random_uuid(),
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at         timestamptz,
  confirmation_token varchar(255) default '',
  confirmation_sent_at timestamptz,
  recovery_token     varchar(255) default '',
  recovery_sent_at   timestamptz,
  email_change_token_new varchar(255) default '',
  email_change       varchar(255) default '',
  email_change_sent_at timestamptz,
  last_sign_in_at    timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  is_super_admin     boolean,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  phone              text unique,
  phone_confirmed_at timestamptz,
  phone_change       text default '',
  phone_change_token varchar(255) default '',
  phone_change_sent_at timestamptz,
  confirmed_at       timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '',
  email_change_confirm_status smallint default 0,
  banned_until       timestamptz,
  reauthentication_token varchar(255) default '',
  reauthentication_sent_at timestamptz,
  is_sso_user        boolean not null default false,
  deleted_at         timestamptz,
  is_anonymous       boolean not null default false
);

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  provider_id     text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  email           text generated always as (lower(identity_data ->> 'email')) stored,
  unique (provider_id, provider)
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub','')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::json ->> 'role','anon')
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- קריטי לנאמנות ה-shim: בסופבייס אמיתי לתפקידים יש גישה לסכמת auth
-- ולפונקציות שבה. בלי זה כל פוליסה שמשתמשת ב-auth.uid() ישירות נכשלת
-- ב-"permission denied for schema auth" — כלומר בדיקות עוברות מהסיבה הלא נכונה.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users, auth.identities to service_role;
