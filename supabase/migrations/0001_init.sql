-- 0001_init.sql — סכמת הליבה של מערכת הניהול של החוג של הניה טייכטל
-- כל שינוי סכמה עובר דרך מיגרציה. אין עריכה ידנית בדשבורד.

-- בסופבייס ההרחבות כבר מותקנות בסכמת extensions. השורות האלה
-- הן no-op שם, ומכסות מסד ריק לגמרי במקום אחר.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ─────────────────────────────── Enums ───────────────────────────────
create type user_role         as enum ('owner','branch_manager','accountant');
create type student_status    as enum ('active','pending','stopped','graduated');
create type payment_method    as enum ('cash','transfer','bit','credit','check','other');
create type entry_scope       as enum ('branch','general','production');
create type entry_kind        as enum ('income','expense');
create type split_method      as enum ('none','equal','by_students','manual');
create type attendance_mark   as enum ('present','late','absent','excused');
create type lesson_status     as enum ('pending','reported','cancelled');
create type msg_direction     as enum ('in','out');
create type msg_status        as enum ('queued','sent','delivered','read','failed');
create type reminder_kind     as enum ('debt','followup','general','attendance','owner_summary','event');
create type reminder_status   as enum ('scheduled','sent','cancelled','failed');
create type command_status    as enum ('pending_confirm','applied','cancelled','rejected','failed');
create type production_status as enum ('planning','rehearsals','filming','editing','released');

-- ─────────────────────────── עזר: updated_at ──────────────────────────
create or replace function f_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ──────────────────────────── טבלאות ליבה ────────────────────────────
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  phone      text,
  role       user_role not null default 'branch_manager',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table seasons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_on  date not null,
  ends_on    date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_current_season on seasons (is_current) where is_current;

create table branches (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  city             text,
  address          text,
  supervisor_name  text,
  supervisor_phone text,
  schedule_text    text,
  weekdays         int[] not null default '{}',
  lesson_time      time,
  default_tuition  numeric(10,2) not null default 0,
  monthly_rent     numeric(10,2) default 0,
  is_active        boolean not null default true,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now()
);

create table branch_staff (
  branch_id uuid references branches(id) on delete cascade,
  user_id   uuid references profiles(id) on delete cascade,
  primary key (branch_id, user_id)
);

create table students (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references seasons(id),
  branch_id       uuid not null references branches(id),
  full_name       text not null,
  birth_date      date,
  grade           text,
  group_name      text,
  parent_name     text,
  parent_phone    text,
  alt_phone       text,
  address         text,
  email           text,
  status          student_status not null default 'active',
  joined_on       date default current_date,
  stopped_on      date,
  stop_reason     text,
  tuition_total   numeric(10,2) not null default 0,
  discount        numeric(10,2) not null default 0,
  discount_reason text,
  installments    int default 1,
  photo_consent   boolean not null default false,
  notes           text,
  source          text,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index students_branch_idx on students(branch_id) where deleted_at is null;
create index students_phone_idx  on students(parent_phone);
-- מחלקת האופרטורים מוסמכת בסכמה במפורש. בלי זה האינדקס תלוי ב-search_path
-- של הסשן, ובבסיס נתונים טרי (בדיוק כמו פרויקט סופבייס חדש) הוא "$user", public
-- בלבד — וההגדרה נופלת על "operator class gin_trgm_ops does not exist".
create index students_name_trgm  on students using gin (full_name extensions.gin_trgm_ops);
create trigger students_touch before update on students
  for each row execute function f_touch_updated_at();

create table payments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  paid_on      date not null default current_date,
  amount       numeric(10,2) not null check (amount > 0),
  method       payment_method not null default 'cash',
  covers_note  text,
  receipt_no   text,
  receipt_url  text,
  collected_by uuid references profiles(id),
  source       text default 'manual',
  note         text,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index payments_student_idx on payments(student_id) where deleted_at is null;

-- ───────────────────────────── הפקות סרטים ────────────────────────────
-- מוגדר לפני ledger_entries: ledger_entries.production_id מפנה לכאן.
create table productions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  year         text,
  status       production_status not null default 'planning',
  budget       numeric(10,2) default 0,
  release_date date,
  notes        text,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table production_cast (
  production_id uuid references productions(id) on delete cascade,
  student_id    uuid references students(id) on delete cascade,
  role_name     text,
  primary key (production_id, student_id)
);

-- חסימת צירוף תלמידה ללא אישור צילום (סעיף 2.4)
create or replace function f_guard_photo_consent() returns trigger
language plpgsql as $$
declare v_ok boolean; v_name text;
begin
  select photo_consent, full_name into v_ok, v_name from students where id = new.student_id;
  if v_ok is not true then
    raise exception 'לא ניתן לצרף את % להפקה ללא אישור צילום', coalesce(v_name,'התלמידה')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger production_cast_consent before insert or update on production_cast
  for each row execute function f_guard_photo_consent();

-- ──────────────────────────── קטגוריות וכספים ─────────────────────────
create table categories (
  id         uuid primary key default gen_random_uuid(),
  scope      entry_scope not null,
  kind       entry_kind  not null,
  name       text not null,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  unique (scope, kind, name)
);

create table ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references seasons(id),
  kind            entry_kind  not null,
  scope           entry_scope not null,
  branch_id       uuid references branches(id),
  production_id   uuid references productions(id),
  entry_date      date not null default current_date,
  category        text not null,
  vendor          text,
  description     text,
  amount          numeric(10,2) not null check (amount > 0),
  method          payment_method,
  receipt_url     text,
  is_recurring    boolean not null default false,
  recurring_day   int check (recurring_day between 1 and 28),
  recurring_until date,
  split_method    split_method not null default 'none',
  split_manual    jsonb,
  created_by      uuid references profiles(id),
  source          text default 'manual',
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint scope_branch_ck check (scope <> 'branch'     or branch_id     is not null),
  constraint scope_prod_ck   check (scope <> 'production' or production_id is not null)
);
create index ledger_branch_idx on ledger_entries(branch_id, entry_date) where deleted_at is null;
create index ledger_scope_idx  on ledger_entries(scope, kind) where deleted_at is null;

-- ─────────────────────────────── נוכחות ──────────────────────────────
create table lessons (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  lesson_date date not null,
  status      lesson_status not null default 'pending',
  reported_at timestamptz,
  reported_by text,
  note        text,
  created_at  timestamptz not null default now(),
  unique (branch_id, lesson_date)
);

create table attendance (
  lesson_id  uuid references lessons(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  mark       attendance_mark not null,
  marked_at  timestamptz not null default now(),
  primary key (lesson_id, student_id)
);

create table attendance_links (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id) on delete cascade,
  token        text not null unique,
  is_active    boolean not null default true,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ──────────────────────── וואטסאפ: תבניות ותזכורות ────────────────────
create table message_templates (
  id        uuid primary key default gen_random_uuid(),
  key       text unique not null,
  name      text not null,
  body      text not null,
  kind      reminder_kind not null,
  is_active boolean not null default true
);

create table reminders (
  id           uuid primary key default gen_random_uuid(),
  kind         reminder_kind not null,
  student_id   uuid references students(id) on delete cascade,
  branch_id    uuid references branches(id) on delete cascade,
  to_phone     text not null,
  to_label     text,
  body         text not null,
  scheduled_at timestamptz not null,
  sent_at      timestamptz,
  status       reminder_status not null default 'scheduled',
  error        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index reminders_due_idx on reminders(scheduled_at) where status='scheduled';

create table wa_messages (
  id          uuid primary key default gen_random_uuid(),
  direction   msg_direction not null,
  phone       text not null,
  body        text,
  status      msg_status,
  green_id    text,
  reminder_id uuid references reminders(id),
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index wa_phone_idx on wa_messages(phone, created_at desc);

-- ───────────────────────── סוכן המענה ללקוחות ─────────────────────────
create table faq_entries (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  answer     text not null,
  keywords   text[] not null default '{}',
  is_active  boolean not null default true,
  hits       int not null default 0,
  created_at timestamptz not null default now()
);

create table conversations (
  id                uuid primary key default gen_random_uuid(),
  phone             text not null unique,
  contact_name      text,
  student_id        uuid references students(id),
  is_human_takeover boolean not null default false,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now()
);

create table unanswered_questions (
  id         uuid primary key default gen_random_uuid(),
  phone      text,
  question   text not null,
  resolved   boolean not null default false,
  faq_id     uuid references faq_entries(id),
  created_at timestamptz not null default now()
);

-- ──────────────────────── פקודות מוואטסאפ ────────────────────────────
create table authorized_numbers (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,
  label      text not null,
  scope      text not null default 'all',
  branch_id  uuid references branches(id),
  can_delete boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table commands (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  raw_text     text not null,
  parsed       jsonb,
  intent       text,
  status       command_status not null default 'pending_confirm',
  result_table text,
  result_id    uuid,
  error        text,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index commands_phone_idx on commands(phone, created_at desc);

-- ────────────────────────── הגדרות, לוג, חגים ─────────────────────────
create table settings (
  key   text primary key,
  value jsonb not null
);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,
  action     text not null,
  table_name text not null,
  row_id     uuid,
  before     jsonb,
  after      jsonb,
  source     text default 'ui',
  created_at timestamptz not null default now()
);

-- נדרש ע"י ה-cron (סעיף 4.5): אין שליחה בשבת ובחגים.
create table holidays (
  day  date primary key,
  name text not null
);

-- ─────────────────────────────── Views ───────────────────────────────
create view v_student_balance as
select s.id as student_id, s.branch_id, s.season_id, s.full_name,
       (s.tuition_total - s.discount) as due,
       coalesce(p.paid,0) as paid,
       (s.tuition_total - s.discount) - coalesce(p.paid,0) as balance,
       p.last_paid_on
from students s
left join (
  select student_id, sum(amount) as paid, max(paid_on) as last_paid_on
  from payments where deleted_at is null group by student_id
) p on p.student_id = s.id
where s.deleted_at is null;

create view v_branch_pnl as
select b.id as branch_id, b.name,
  (select coalesce(sum(vb.paid),0) from v_student_balance vb where vb.branch_id=b.id) as income_students,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='income' and l.scope='branch' and l.deleted_at is null) as income_other,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='expense' and l.scope='branch' and l.deleted_at is null) as expenses,
  (select coalesce(sum(vb.balance),0) from v_student_balance vb where vb.branch_id=b.id) as open_debt,
  (select count(*) from students s where s.branch_id=b.id and s.status='active' and s.deleted_at is null) as active_students
from branches b where b.deleted_at is null;

-- ───────────────── חלוקת הוצאות כלליות בין הסניפים ───────────────────
create or replace function f_general_allocation(p_season uuid)
returns table (branch_id uuid, allocated_amount numeric)
language sql stable as $$
  with active_branches as (
    select b.id,
           (select count(*) from students s
             where s.branch_id=b.id and s.status='active' and s.deleted_at is null
               and s.season_id=p_season) as students
    from branches b where b.deleted_at is null and b.is_active
  ),
  totals as (
    select (select count(*) from active_branches) as n_branches,
           (select nullif(sum(students),0) from active_branches) as n_students
  ),
  entries as (
    select l.id, l.amount, l.split_method, l.split_manual
    from ledger_entries l
    where l.scope='general' and l.kind='expense'
      and l.deleted_at is null and l.season_id=p_season
  )
  select ab.id,
         round(coalesce(sum(
           case e.split_method
             when 'equal'       then e.amount / nullif(t.n_branches,0)
             when 'by_students' then e.amount * ab.students::numeric / nullif(t.n_students,0)
             when 'manual'      then e.amount * coalesce((e.split_manual ->> ab.id::text)::numeric, 0)
             else 0
           end
         ),0), 2)
  from active_branches ab
  cross join totals t
  left join entries e on true
  group by ab.id;
$$;
