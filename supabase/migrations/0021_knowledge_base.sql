-- 0021 — "מידע על החוג": בסיס ידע חופשי שממנו הסוכן עונה, בנוסף למאגר
-- השאלות. קטעים עם כותרת, כדי לערוך חלק בלי לגעת בשאר. הבעלים בלבד.
create table knowledge_sections (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null default '',
  position   int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger knowledge_sections_touch before update on knowledge_sections
  for each row execute function f_touch_updated_at();

alter table knowledge_sections enable row level security;
create policy knowledge_owner on knowledge_sections for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');
revoke all on knowledge_sections from anon, public;
grant select, insert, update, delete on knowledge_sections to authenticated;
grant all on knowledge_sections to service_role;
