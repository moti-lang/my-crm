-- שים (shim) מקומי בלבד: מחקה את מה ש-Supabase מספקת (סכמת auth + תפקידים).
-- לא חלק מהמיגרציות. משמש להרצת הסכמה, ה-seed והבדיקות על פוסטגרס מקומי.
create schema if not exists auth;

create table if not exists auth.users (
  instance_id        uuid,
  id                 uuid primary key default gen_random_uuid(),
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  confirmation_token     text default '',
  recovery_token         text default '',
  email_change_token_new text default '',
  email_change           text default ''
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
grant select on auth.users to service_role;
