# אפיון טכני לבנייה — מערכת הניהול של החוג של הניה טייכטל

**גרסה:** 2.1 · מסמך בנייה (Build Spec)
**קהל היעד:** סוכן פיתוח (Claude Code). מסמך זה הוא מקור האמת היחיד.

> **שינויים מגרסה 2.0**
> * **וואטסאפ: לא Green API.** המערכת עובדת מול `whatsapp-hub` — שרת עצמאי.
>   החוזה המחייב הוא [`docs/whatsapp-contract.md`](./whatsapp-contract.md),
>   שנגזר מקוד השרת. במקרה של סתירה בין המסמך הזה לחוזה — **החוזה מנצח**,
>   כי הוא נקרא מהקוד.
> * `msg_status` צומצם ל-`queued/sent/failed`. לשרת אין אירועי מסירה או קריאה.
> * **המודל אינו ערך קשיח.** הוא נקבע ב-`ANTHROPIC_MODEL`, וברירת המחדל
>   היא `claude-sonnet-4-6`. `supabase/tests/model-benchmark.mjs` משווה
>   מודלים על 30 פקודות עבריות אמיתיות (intent, סכום, סניף) ומכריע
>   לפי מדידה ולא לפי הערכה.
>
>   **המדידה בוצעה (2026-09-02, 60 קריאות אמיתיות):**
>
>   | | intent | סכום | סניף | סה"כ |
>   |---|---|---|---|---|
>   | `claude-sonnet-4-6` | 28/30 (93%) | 17/17 (100%) | 12/13 (92%) | 57/60 |
>   | `claude-opus-5`     | 29/30 (97%) | 17/17 (100%) | 13/13 (100%) | 59/60 |
>
>   הפרש 3% — לא משמעותי. **ברירת המחדל נשארת `claude-sonnet-4-6`.**
>   הסכומים מדויקים ב-100% בשני המודלים, וזה השדה היקר ביותר בטעות.
> * **תקרת זמן קשיחה של 8 שניות** (`AI_TIMEOUT_MS`). מעליה הסוכן משיב
>   "רגע, בודקת…" בוואטסאפ ואינו נתקע בשקט — שתיקה אחרי פקודה כספית
>   משאירה את הניה בלי לדעת אם ההוצאה נרשמה. התלייה אינה כותבת דבר.
> * **הקריאה האמיתית ל-API נבדקת בכל ריצת CI** (`npm run test:contract`,
>   או `.github/workflows/ci.yml`). פיקסצ'רים מוקלטים לא יתפסו שינוי בצד
>   ה-API — הם מוקלטים אצלנו. הבדיקה מוודאת שהחוזה מתקבל ושחציון זמן
>   התגובה מתחת ל-`AI_CONTRACT_MAX_MS` (ברירת מחדל 3000).
>
>   **זמני תגובה שנמדדו (חציון של 3):**
>
>   | מודל | זמן | דיוק |
>   |---|---|---|
>   | `claude-haiku-4-5`  | ~1,700ms | 56/60 |
>   | `claude-sonnet-4-6` | 2,500-2,900ms, ולעיתים מעל 4,000 | 57/60 |
>   | `claude-opus-5`     | לא נמדד לזמן | 59/60 |
>
>   ברירת המחדל `claude-sonnet-4-6` יושבת על הסף ולא מתחתיו בוודאות.
>   `claude-haiku-4-5` עומד בו בנוחות במחיר נקודה אחת מתוך 60.
>   קאשינג לא רלוונטי כאן: הקלט הוא 817 טוקנים, מתחת למינימום לקאש
>   (`cache_read_input_tokens` נמדד 0 גם עם `cache_control`).
> * **אין `output_config` בקריאה למודל.** נוסה ונדחה שלוש פעמים
>   (`minimum/maximum` על number, `additionalProperties: true` על `fields`,
>   ואז `Schema is too complex` כשכל 21 השדות מנויים), ובגדלים שכן התקבלו
>   הבקשה האטה פי 4 ומעלה — 5 שדות ≈ 7.6 שניות מול ~2 בלי. גם `prefill`
>   אינו נתמך במודל. החוזה מוגדר בפרומפט, `extractJson` מסיר עטיפה,
>   ו-`validateCommand` מאמת. `supabase/tests/ai-wire.test.mjs` שומר על זה.

---

## 0. הוראות עבודה לסוכן הבונה — לקרוא ראשון

1. **אל תשאל שאלות.** כל החלטה כבר התקבלה במסמך הזה. אם משהו לא מוגדר במפורש — החלט לפי סעיף 0.3 והמשך.
2. **אל תבקש אישור באמצע.** בנה שלב שלם, הרץ בדיקות, דווח מה נבנה, המשך לשלב הבא.
3. **אל תבנה mock.** כל מסך מחובר ל‑Supabase אמיתי. אין נתונים קשיחים בקוד חוץ מקובץ ה‑seed.
4. **סיים כל שלב עם:** בילד עובר, `tsc --noEmit` נקי, ה‑seed רץ, וכל תנאי הקבלה של השלב מסומנים.

### 0.1 מחסנית טכנולוגית — קבוע, לא לשנות

| רכיב | בחירה |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| עיצוב | Tailwind CSS (RTL מלא) |
| ניתוב | React Router v6 |
| State / data | TanStack Query (React Query) |
| טפסים | React Hook Form + Zod |
| Backend | Supabase — Postgres, Auth, Storage, Edge Functions, pg_cron |
| WhatsApp | `whatsapp-hub` (שרת עצמאי) — ראה `docs/whatsapp-contract.md` |
| AI | Claude API דרך Edge Function בלבד. המודל ב-`ANTHROPIC_MODEL`, ברירת מחדל `claude-sonnet-4-6` |
| גרפים | Recharts |
| תאריכים | date-fns + `he` locale |
| אחסון | Netlify (frontend) · Supabase (backend) |

### 0.2 קבועים גלובליים

* שפה: עברית בלבד. `dir="rtl"` על ה‑`<html>`.
* אזור זמן: `Asia/Jerusalem`. כל `timestamptz` נשמר UTC ומוצג בשעון ישראל.
* מטבע: ש״ח. פורמט `₪1,234`. סכומים נשמרים ב‑`numeric(10,2)`.
* תאריכים בתצוגה: `dd/MM/yyyy`.
* טלפונים נשמרים מנורמלים: `972XXXXXXXXX` (בלי `+`, בלי מקפים). תצוגה: `05X-XXX-XXXX`.
* שמות טבלאות ועמודות באנגלית snake_case. כל טקסט למשתמש בעברית.

### 0.3 כללי הכרעה כשמשהו לא מוגדר

* חסר שדה → הוסף אותו כ‑nullable ותן לו UI.
* לא ברור אם למחוק או לארכב → **תמיד soft delete** (`deleted_at`).
* לא ברור אם פעולה מסוכנת → הוסף מסך אישור.
* לא ברור איזה עיצוב → לך לפי סעיף 8.
* התנגשות בין המסמך לבין קוד קיים → המסמך מנצח.

### 0.4 החלטות שכבר נסגרו (לא לשאול עליהן)

* אין סליקת אשראי בגרסה 1. תשלומים נרשמים ידנית או דרך הוואטסאפ. טבלת `payments` מוכנה לסליקה עתידית.
* מספר וואטסאפ אחד לכל העסק (instance אחד ב‑`whatsapp-hub`).
* שנת פעילות = `season`. מחיר הבסיס נקבע ברמת הסניף, וניתן לדריסה פר תלמידה.
* סוכן המענה ללקוחות **לא נוקב במחירים** — מפנה לשיחה עם הבעלים. זה ערך ב‑`settings` שניתן לשינוי מהממשק.
* עברית בלבד, ללא i18n.
* אחראית נוכחות היא לא משתמשת רשומה — היא נכנסת בטוקן בלבד.

---

## 1. מפת המערכת

```
┌───────────────────────── Frontend (React) ─────────────────────────┐
│ דשבורד · סניפים · תלמידות · גבייה · הוצאות · כללי · הפקות ·        │
│ נוכחות · תזכורות · סוכן AI · פקודות וואטסאפ · דוחות · הגדרות       │
└───────────────┬────────────────────────────────────────────────────┘
                │ supabase-js (JWT + RLS)
┌───────────────▼───────────────────────────────────────────────────┐
│                          Supabase                                  │
│  Postgres + RLS   │  Storage (קבלות)  │  Auth  │  pg_cron          │
│  Edge Functions:                                                   │
│   wa-webhook · wa-send · ai-command · ai-answer                    │
│   cron-reminders · cron-daily-summary · cron-attendance-watch      │
│   cron-wa-health                                                   │
└───────┬──────────────────────────────┬────────────────────────────┘
        │ x-api-key / HMAC             │ Claude API
   ┌────▼─────────┐               ┌────▼─────┐
   │ whatsapp-hub │               │  Claude  │
   │ (שרת עצמאי)  │               └──────────┘
   └──────────────┘
        │
        ├── לקוחות נכנסים  → ai-answer (מאגר שאלות)
        ├── מספרים מורשים → ai-command (פקודות כתיבה למערכת)
        └── יוצא: תזכורות, סיכומים, התראות
```

---

## 2. מודל נתונים — SQL מלא

הרץ כמיגרציה אחת: `supabase/migrations/0001_init.sql`.

### 2.1 Enums

```sql
create type user_role       as enum ('owner','branch_manager','accountant');
create type student_status  as enum ('active','pending','stopped','graduated');
create type payment_method  as enum ('cash','transfer','bit','credit','check','other');
create type entry_scope     as enum ('branch','general','production');
create type entry_kind      as enum ('income','expense');
create type split_method    as enum ('none','equal','by_students','manual');
create type attendance_mark as enum ('present','late','absent','excused');
create type lesson_status   as enum ('pending','reported','cancelled');
create type msg_direction   as enum ('in','out');
create type msg_status      as enum ('queued','sent','delivered','read','failed');
create type reminder_kind   as enum ('debt','followup','general','attendance','owner_summary','event');
create type reminder_status as enum ('scheduled','sent','cancelled','failed');
create type command_status  as enum ('pending_confirm','applied','cancelled','rejected','failed');
create type production_status as enum ('planning','rehearsals','filming','editing','released');
```

### 2.2 טבלאות ליבה

```sql
-- משתמשים (משלים את auth.users)
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  phone        text,
  role         user_role not null default 'branch_manager',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,              -- 'תשפ״ז 2026/27'
  starts_on   date not null,
  ends_on     date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index one_current_season on seasons (is_current) where is_current;

create table branches (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  city           text,
  address        text,
  supervisor_name  text,
  supervisor_phone text,             -- 972...
  schedule_text  text,               -- 'ראשון ורביעי 16:30'
  weekdays       int[] default '{}', -- 0=ראשון .. 6=שבת
  lesson_time    time,
  default_tuition numeric(10,2) not null default 0,
  monthly_rent   numeric(10,2) default 0,
  is_active      boolean not null default true,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- שיוך מנהלת סניף לסניפים שלה
create table branch_staff (
  branch_id uuid references branches(id) on delete cascade,
  user_id   uuid references profiles(id) on delete cascade,
  primary key (branch_id, user_id)
);

create table students (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id),
  branch_id     uuid not null references branches(id),
  full_name     text not null,
  birth_date    date,
  grade         text,                    -- 'ד'
  group_name    text,
  parent_name   text,
  parent_phone  text,                    -- 972... — יעד התזכורות
  alt_phone     text,
  address       text,
  email         text,
  status        student_status not null default 'active',
  joined_on     date default current_date,
  stopped_on    date,
  stop_reason   text,
  tuition_total numeric(10,2) not null default 0,
  discount      numeric(10,2) not null default 0,
  discount_reason text,
  installments  int default 1,
  photo_consent boolean not null default false,
  notes         text,
  source        text,                    -- 'whatsapp' | 'manual' | 'import'
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index students_branch_idx on students(branch_id) where deleted_at is null;
create index students_phone_idx  on students(parent_phone);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  paid_on      date not null default current_date,
  amount       numeric(10,2) not null check (amount > 0),
  method       payment_method not null default 'cash',
  covers_note  text,               -- 'תשלום 2 מתוך 3'
  receipt_no   text,
  receipt_url  text,               -- Storage
  collected_by uuid references profiles(id),
  source       text default 'manual',  -- 'manual' | 'whatsapp'
  note         text,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index payments_student_idx on payments(student_id) where deleted_at is null;
```

### 2.3 כספים — הוצאות והכנסות בטבלה אחת

טבלה אחת `ledger_entries` מכסה: הוצאות סניף, הוצאות והכנסות כלליות, וכספי הפקות. זה מה שמאפשר דוח רווח והפסד אחד.

```sql
create table ledger_entries (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references seasons(id),
  kind          entry_kind  not null,
  scope         entry_scope not null,
  branch_id     uuid references branches(id),      -- חובה כאשר scope='branch'
  production_id uuid references productions(id),   -- חובה כאשר scope='production'
  entry_date    date not null default current_date,
  category      text not null,
  vendor        text,
  description   text,
  amount        numeric(10,2) not null check (amount > 0),
  method        payment_method,
  receipt_url   text,
  is_recurring  boolean not null default false,
  recurring_day int,                                -- 1-28
  recurring_until date,
  split_method  split_method not null default 'none', -- רלוונטי ל-scope='general'
  split_manual  jsonb,                              -- {"branch_uuid": 0.4, ...}
  created_by    uuid references profiles(id),
  source        text default 'manual',
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint scope_branch_ck  check (scope <> 'branch' or branch_id is not null),
  constraint scope_prod_ck    check (scope <> 'production' or production_id is not null)
);
create index ledger_branch_idx on ledger_entries(branch_id, entry_date) where deleted_at is null;
create index ledger_scope_idx  on ledger_entries(scope, kind) where deleted_at is null;
```

**קטגוריות ברירת מחדל** (טבלת `categories`, ניתנות לעריכה מההגדרות):
הוצאות סניף: שכירות אולם, שכר מדריכה, הגברה ותאורה, תלבושות, תפאורה, ציוד מתכלה, פרסום מקומי, הסעות, ניקיון, כיבוד, אחר.
הוצאות כלליות: פרסום ארצי, הנהלת חשבונות, אתר ומערכות, אירוע סוף שנה, ייעוץ, אחר.
הכנסות: תשלומי תלמידות, כרטיסים להצגה, מכירת תלבושות, חסויות, מכירת עותקים, אחר.
הפקה: צלם, עריכה, מוזיקה, תפאורה, תלבושות ואיפור, אולם צילום, הסעות, כיבוד, שכפול והפצה, פרסום.

### 2.4 הפקות סרטים

```sql
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
```

הוצאות והכנסות של הפקה נרשמות ב‑`ledger_entries` עם `scope='production'`.
**כלל:** לא ניתן לצרף תלמידה ל‑`production_cast` אם `photo_consent=false` — המערכת חוסמת ומציגה הודעה.

### 2.5 נוכחות

```sql
create table lessons (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  lesson_date date not null,
  status      lesson_status not null default 'pending',
  reported_at timestamptz,
  reported_by text,                       -- שם האחראית (טוקן, לא משתמש)
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
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  token       text not null unique,       -- 32 תווים אקראיים
  is_active   boolean not null default true,
  last_used_at timestamptz,
  created_at  timestamptz not null default now()
);
```

**יצירת שיעורים אוטומטית:** job לילי יוצר `lessons` ליום המחרת לכל סניף פעיל שבו `weekdays` מכיל את יום השבוע.

### 2.6 וואטסאפ — הודעות, תבניות, תזכורות

```sql
create table message_templates (
  id       uuid primary key default gen_random_uuid(),
  key      text unique not null,     -- 'debt_reminder'
  name     text not null,
  body     text not null,            -- עם משתנים {student_name} וכו'
  kind     reminder_kind not null,
  is_active boolean not null default true
);

create table reminders (
  id            uuid primary key default gen_random_uuid(),
  kind          reminder_kind not null,
  student_id    uuid references students(id) on delete cascade,
  branch_id     uuid references branches(id) on delete cascade,
  to_phone      text not null,
  to_label      text,                       -- 'רחלי כהן · שירה'
  body          text not null,              -- אחרי הרכבת המשתנים
  scheduled_at  timestamptz not null,
  sent_at       timestamptz,
  status        reminder_status not null default 'scheduled',
  error         text,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
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
```

**משתנים בתבניות:** `{student_name}` `{parent_name}` `{branch}` `{balance}` `{total}` `{paid}` `{date}` `{time}` `{lesson_date}`.
מנוע ההרכבה מחליף כל משתנה שאין לו ערך במחרוזת ריקה ומנקה רווחים כפולים.

**תבניות ברירת מחדל שיש ליצור ב‑seed:**

| key | תוכן |
|---|---|
| `debt_reminder` | היי {parent_name}, תזכורת קטנה — נותרה יתרה של {balance} עבור {student_name} בסניף {branch}. אפשר להעביר בביט או בהעברה, תודה רבה 🌸 |
| `followup` | היי {parent_name}, מדברים מהחוג של הניה טייכטל. ביקשת שנחזור אלייך — נשמח לשמוע מה החלטתם 😊 |
| `lesson_cancel` | הודעה להורים: השיעור בסניף {branch} בתאריך {lesson_date} מבוטל. נעדכן על מועד חלופי. |
| `absence_alert` | היי {parent_name}, שמנו לב ש{student_name} לא הגיעה לשלושה שיעורים אחרונים. הכל בסדר? נשמח לדעת. |
| `owner_daily` | סיכום היום: נוכחות דווחה ב-{reported}/{total} סניפים · נכנסו {income} · {new_leads} פניות חדשות · {debtors} חייבות בסך {debt}. |
| `owner_weekly` | סיכום שבועי: נגבו {income} · נותרו {debt} מ-{debtors} תלמידות · {unanswered} שאלות ממתינות לתשובה. |
| `supervisor_nudge` | היי {parent_name}, עדיין לא דיווחת נוכחות לשיעור של היום בסניף {branch}. הקישור: {link} |

### 2.7 סוכן המענה ללקוחות

```sql
create table faq_entries (
  id        uuid primary key default gen_random_uuid(),
  question  text not null,
  answer    text not null,
  keywords  text[] not null default '{}',
  is_active boolean not null default true,
  hits      int not null default 0,
  created_at timestamptz not null default now()
);

create table conversations (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null unique,
  contact_name  text,
  student_id    uuid references students(id),
  is_human_takeover boolean not null default false,
  last_message_at timestamptz,
  created_at    timestamptz not null default now()
);

create table unanswered_questions (
  id        uuid primary key default gen_random_uuid(),
  phone     text,
  question  text not null,
  resolved  boolean not null default false,
  faq_id    uuid references faq_entries(id),
  created_at timestamptz not null default now()
);
```

**מאגר שאלות ל‑seed** — 10 שאלות: מחיר, סניפים, גילאים, ימים ושעות, איך נרשמים, הצגה וסרט בסוף שנה, שיעור ניסיון, הנחה לאחות שנייה, מה להביא, הצטרפות באמצע השנה.

### 2.8 פקודות מוואטסאפ

```sql
create table authorized_numbers (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,        -- 972...
  label      text not null,               -- 'הניה (אישי)'
  scope      text not null default 'all', -- 'all' | 'finance' | 'branch'
  branch_id  uuid references branches(id),
  can_delete boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table commands (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null,
  raw_text      text not null,
  parsed        jsonb,                    -- הפלט של ai-command
  intent        text,
  status        command_status not null default 'pending_confirm',
  result_table  text,
  result_id     uuid,
  error         text,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index commands_phone_idx on commands(phone, created_at desc);
```

### 2.9 הגדרות ולוג

```sql
create table settings (
  key   text primary key,
  value jsonb not null
);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,          -- user_id או מספר טלפון
  action     text not null,          -- 'insert' | 'update' | 'delete'
  table_name text not null,
  row_id     uuid,
  before     jsonb,
  after      jsonb,
  source     text default 'ui',      -- 'ui' | 'whatsapp' | 'cron'
  created_at timestamptz not null default now()
);
```

**ערכי `settings` ל‑seed:**

```json
{ "quiet_hours": {"from":"21:30","to":"08:00","no_shabbat":true},
  "debt_reminder_days": [30,60,90],
  "attendance_nudge_minutes": 120,
  "absence_alert_streak": 3,
  "agent_may_quote_prices": false,
  "owner_phone": "972...",
  "daily_summary_time": "21:00",
  "weekly_summary_day": 0,
  "command_confirm_threshold": 0 }
```

`command_confirm_threshold: 0` = כל פקודת כתיבה דורשת אישור. אם יעלה ל‑500, פקודות מתחת ל‑500 ש״ח יבוצעו ישירות.

### 2.10 Views לחישובים

```sql
create view v_student_balance as
select s.id student_id, s.branch_id, s.season_id, s.full_name,
       (s.tuition_total - s.discount) as due,
       coalesce(p.paid,0) as paid,
       (s.tuition_total - s.discount) - coalesce(p.paid,0) as balance,
       p.last_paid_on
from students s
left join (
  select student_id, sum(amount) paid, max(paid_on) last_paid_on
  from payments where deleted_at is null group by student_id
) p on p.student_id = s.id
where s.deleted_at is null;

create view v_branch_pnl as
select b.id branch_id, b.name,
  (select coalesce(sum(vb.paid),0) from v_student_balance vb where vb.branch_id=b.id) income_students,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='income' and l.scope='branch' and l.deleted_at is null) income_other,
  (select coalesce(sum(l.amount),0) from ledger_entries l
     where l.branch_id=b.id and l.kind='expense' and l.scope='branch' and l.deleted_at is null) expenses,
  (select coalesce(sum(vb.balance),0) from v_student_balance vb where vb.branch_id=b.id) open_debt,
  (select count(*) from students s where s.branch_id=b.id and s.status='active' and s.deleted_at is null) active_students
from branches b where b.deleted_at is null;
```

**פונקציית חלוקת הוצאות כלליות** `f_general_allocation(season uuid)` מחזירה `(branch_id, allocated_amount)` לפי `split_method` של כל רשומה: `equal` = חלוקה שווה בין סניפים פעילים, `by_students` = יחסית למספר תלמידות פעילות, `manual` = לפי `split_manual`, `none` = לא מחולק. הדוח מציג שתי שורות: רווח סניף לפני ואחרי הקצאת הוצאות הנהלה.

---

## 3. הרשאות ו‑RLS

הפעל RLS על כל טבלה. פונקציות עזר:

```sql
create function auth_role() returns user_role language sql stable as $$
  select role from profiles where id = auth.uid()
$$;

create function my_branches() returns setof uuid language sql stable as $$
  select branch_id from branch_staff where user_id = auth.uid()
$$;
```

מטריצת הרשאות:

| טבלה | owner | branch_manager | accountant | anon (טוקן) |
|---|---|---|---|---|
| branches | הכל | קריאה לסניפים שלה | קריאה | — |
| students | הכל | הכל בסניפים שלה | קריאה ללא טלפון/כתובת | קריאת שם בלבד דרך RPC |
| payments | הכל | הוספה וקריאה בסניפים שלה | קריאה | — |
| ledger_entries | הכל | סניפים שלה בלבד | קריאה | — |
| productions | הכל | קריאה | קריאה | — |
| lessons / attendance | הכל | סניפים שלה | — | כתיבה דרך RPC בלבד |
| reminders, wa_messages | הכל | קריאה | — | — |
| authorized_numbers, commands, settings | הכל | — | — | — |
| audit_log | קריאה | — | — | — |

דוגמת פוליסה:

```sql
alter table students enable row level security;

create policy students_owner on students for all
  using (auth_role() = 'owner') with check (auth_role() = 'owner');

create policy students_manager on students for all
  using (auth_role() = 'branch_manager' and branch_id in (select my_branches()))
  with check (auth_role() = 'branch_manager' and branch_id in (select my_branches()));

create policy students_accountant on students for select
  using (auth_role() = 'accountant');
```

**נוכחות ללא התחברות:** שתי פונקציות `security definer` בלבד, ללא גישת טבלה ל‑anon:

```sql
create function rpc_attendance_sheet(p_token text)
returns jsonb language plpgsql security definer as $$ ... $$;
-- מחזיר: {branch_name, supervisor_name, lesson_date, lesson_id,
--          students:[{id, full_name}]}  — ללא טלפונים, ללא כסף

create function rpc_attendance_submit(p_token text, p_lesson uuid, p_marks jsonb)
returns jsonb language plpgsql security definer as $$ ... $$;
-- מאמת טוקן פעיל + שהשיעור שייך לסניף, כותב attendance,
-- מסמן lessons.status='reported', מעדכן last_used_at,
-- מפעיל התראת בעלים ובדיקת רצף היעדרויות
```

---

## 4. Edge Functions

כל הפונקציות ב‑`supabase/functions/`. משתני סביבה:
`WA_SERVER_URL`, `WA_API_KEY`, `WA_WEBHOOK_SECRET`, `WA_DRY_RUN`,
`ANTHROPIC_API_KEY`, `AI_DRY_RUN`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_ALERT_WEBHOOK`.

`WA_DRY_RUN` ו‑`AI_DRY_RUN` הם `true` כברירת מחדל — צריך `false` מפורש כדי לצאת החוצה.

### 4.1 `wa-send`

קלט: `{ to, body, reminder_id?, idempotency_key? }`.

**סדר הפעולות:**

1. **בדיקת בריאות החיבור** (`settings.wa_health`). אם `status='down'` — מחזירים
   `503`, התזכורת נשארת `scheduled`, ו**לעולם לא מסומנת `sent`**. הודעה שלא
   יצאה אינה נספרת כאילו יצאה.
2. נרמול המספר ל‑`972XXXXXXXXX`.
3. שעות שקטות (`settings.quiet_hours`, שבת וחגים). אם חסום — דחייה לחלון
   המותר הבא ועדכון `reminders.scheduled_at`.
4. `POST {WA_SERVER_URL}/api/send` עם `{phone, text, source}`, כותרות
   `x-api-key` ו‑`Idempotency-Key`.
5. רישום ב‑`wa_messages` עם `provider_msg_id`, ועדכון `reminders.status`.

**מפתח הייחודיות:** לתזכורת — `reminder-{id}`. אחרת — טביעת אצבע של
היעד, הטקסט והדקה. ניסיון חוזר מחזיר את התשובה המקורית ולא שולח פעמיים.

**כישלון:** עד 3 ניסיונות עם השהיה מדורגת (1ש׳, 3ש׳). שגיאת `4xx` אינה
מנוסה שוב. בסוף — `status='failed'` עם השגיאה. **אין כשל שקט:** כל מסלול
מסתיים ברישום מפורש — `sent`, `failed`, `deferred` או `held`.

הפרטים המחייבים — פורמט, קודי תשובה, אלגוריתם החתימה — ב‑`docs/whatsapp-contract.md`.

### 4.1א `cron-wa-health` — ניטור החיבור

רץ כל 10 דקות, קורא `GET /api/health`. השרת מחזיר `503` כשוואטסאפ מנותק.

שני מנגנוני זיהוי, כי אף אחד לבדו אינו מספיק:

* `connection.changed` דרך ה‑webhook — מיידי, אבל מגיע רק כשהשרת חי.
* ה‑cron — תופס את המקרה שבו השרת עצמו מת ואף webhook לא יגיע.
  **שקט אינו סימן לבריאות.**

אחרי שתי בדיקות כושלות רצופות: `wa_health.status='down'`, התור נעצר,
והתראה יוצאת לבעלים.

**ההתראה אינה עוברת בוואטסאפ.** היא נכתבת ל‑`audit_log` ול‑`system_alerts`
(שמזין באנר בדשבורד ואינדיקטור בהגדרות), ונשלחת ל‑`OWNER_ALERT_WEBHOOK`
אם הוגדר. התראה על נפילת וואטסאפ שעוברת בוואטסאפ נופלת בדיוק כשהיא נחוצה.
יש בדיקה מבנית שנכשלת אם מישהו יחבר ביניהם.

### 4.2 `wa-webhook` — הנתב הראשי

זו נקודת הכניסה לכל הודעה נכנסת. הסדר קריטי:

```
1. אימות חתימת HMAC-SHA256 (x-hub-signature) על הגוף הגולמי.
   לא תקין → 401, בלי שום נגיעה במסד.
2. מניעת כפילויות: provider_msg_id עם אינדקס ייחודי.
   מזהה שכבר קיים → מסיימים בשקט (השרת שולח שוב אחרי ריסטארט).
   אירוע בלי מזהה → לא מעובד כלל + התראה.
3. חילוץ phone + text. רישום ב-wa_messages (direction='in').
4. האם phone קיים ב-authorized_numbers ו-is_active?
   כן → מסלול פקודות (4.3)
   לא → מסלול לקוחות (4.4)
5. מספר לא מוכר ששולח טקסט שנראה כמו פקודה
   (מכיל 'תעדכן' / 'תרשום' / 'הוצאה' / 'תמחק')
   → רישום ב-commands עם status='rejected'
   → התראה לבעלים: "ניסיון פקודה ממספר לא מורשה: {phone}"
   → ואז ממשיך למסלול לקוחות רגיל.
```

### 4.3 מסלול פקודות (מספר מורשה)

```
א. יש ל-phone פקודה ב-status='pending_confirm' מ-10 הדקות האחרונות?
   - הטקסט הוא 'כן'/'אישור'/'אשר'/'✅'/'1' → בצע (4.3.3)
   - הטקסט הוא 'לא'/'בטל'/'ביטול'      → status='cancelled', "בוטל, לא נשמר כלום."
   - טקסט אחר → סמן את הקודמת 'cancelled' והמשך לפרסור החדש.
ב. הטקסט הוא 'בטל' ללא פקודה ממתינה → בטל (rollback) את הפקודה האחרונה
   ב-status='applied' של המספר הזה, סמן 'cancelled', כתוב ל-audit_log,
   והשב: "↩️ בוטל: {תיאור}".
ג. אחרת → ai-command (4.3.1)
```

#### 4.3.1 `ai-command` — פרסור

קריאה ל‑Claude עם `max_tokens: 800`, טמפרטורה 0, והנחיה להחזיר **JSON בלבד**.

**System prompt (להטמיע כלשונו):**

```
אתה מנוע פקודות של מערכת ניהול לחוג דרמה בישראל.
הקלט הוא הודעת וואטסאפ בעברית מבעלת העסק או מהצוות.
החזר JSON בלבד. בלי הסברים, בלי markdown, בלי טקסט לפני או אחרי.

סכימה:
{
  "intent": "expense" | "income" | "payment" | "new_student" | "update_student" |
            "reminder" | "attendance" | "query" | "unknown",
  "confidence": 0.0-1.0,
  "fields": { ... },
  "missing": ["שם השדה שחסר"],
  "human_summary": "משפט אחד בעברית שמתאר מה הבנת"
}

שדות לפי intent:
expense  → amount (מספר), branch (שם סניף או null), category, vendor, date (YYYY-MM-DD או null), production (שם סרט או null)
income   → amount, branch או null (null = כללי), category, description
payment  → student_name, amount, method (cash|transfer|bit|credit|check), date
new_student → full_name, branch, grade, parent_name, parent_phone, tuition
update_student → student_name, field, value
reminder → target (student_name או phone או "owner"), when_text, offset_days, body
attendance → branch, date, absent_students[]
query    → question_type: "debtors"|"income"|"profit"|"student_count"|"attendance"|"balance", branch או null

כללים:
- סכומים: מספרים בלבד, בלי ₪ ובלי פסיקים.
- "היום"/"אתמול"/"אמש" → תרגם לתאריך לפי התאריך שסופק בהקשר.
- שמות סניפים אפשריים מסופקים בהקשר. התאם לשם הקרוב ביותר; אין התאמה → null.
- אם חסר שדה קריטי (סכום לפעולה כספית, שם תלמידה לתשלום) — רשום אותו ב-missing.
- אם אינך בטוח מה נדרש — intent "unknown" עם confidence נמוך. לעולם אל תנחש סכום.
- לעולם אל תמציא שמות של תלמידות או סניפים שלא הופיעו בהקשר.
```

**User message** מכיל: הטקסט, התאריך של היום, רשימת שמות הסניפים, רשימת שמות התלמידות הפעילות (שם + סניף), ורשימת הקטגוריות.

#### 4.3.2 טיפול בתוצאה

| מצב | פעולה |
|---|---|
| `confidence < 0.6` או `intent='unknown'` | השב עם 3 דוגמאות ניסוח נכון. אל תשמור כלום. |
| `missing` לא ריק | שאל שאלה אחת ממוקדת ("כמה?"), שמור `pending_confirm` והמתן להשלמה. |
| `intent='query'` | הרץ את השאילתה מול ה‑views, השב מיד בטקסט מעוצב. **ללא אישור** — קריאה בלבד. |
| `student_name` לא נמצא | חיפוש דמיון (trigram). התאמה יחידה מעל 0.6 → קבל. כמה התאמות → הצג רשימה ממוספרת ובקש לבחור מספר. |
| שאר המקרים | שמור `commands` עם `pending_confirm`, שלח כרטיס אישור. |

**פורמט כרטיס האישור:**

```
זיהיתי הוצאה:
סכום: ₪860
סניף: ביתר עילית
קטגוריה: תלבושות
תאריך: 01/09/2026

לאישור השיבי: כן
לביטול: לא
```

#### 4.3.3 ביצוע

לפי `intent`, בתוך טרנזקציה אחת: כתיבה לטבלה + `commands.status='applied'` + `result_table/result_id` + `audit_log` עם `source='whatsapp'`.
הודעת אישור: `✅ נרשם. {human_summary}. לביטול כתבי: בטל`.

בדיקות הרשאה לפני כתיבה:
* `scope='branch'` → הפעולה חייבת להיות בסניף המשויך, אחרת דחייה מנומסת.
* `scope='finance'` → מותר `expense`, `income`, `payment`, `query` בלבד.
* מחיקה מותרת רק ל‑`can_delete=true`.

#### 4.3.4 ביטול (rollback)

לכל `intent` הפיך: `payment` → מחיקה רכה של התשלום. `expense`/`income` → מחיקה רכה של הרשומה. `new_student` → מחיקה רכה. `update_student` → החזרת `before` מה‑`audit_log`. `reminder` → `status='cancelled'`.
חלון ביטול: 24 שעות. אחרי זה: "הפעולה ישנה מדי לביטול אוטומטי, אפשר לתקן במערכת."

### 4.4 מסלול לקוחות — `ai-answer`

```
1. שליפה/יצירה של conversation לפי טלפון.
2. is_human_takeover=true → רק לוג, בלי מענה אוטומטי.
3. שליפת כל faq_entries הפעילות + settings.agent_may_quote_prices.
4. קריאה ל-Claude (temperature 0.3, max_tokens 400).
5. אין תשובה מתאימה → תשובת הפניה + רשומה ב-unanswered_questions
   + התראה מיידית לבעלים עם השאלה והטלפון.
6. זוהתה כוונת הרשמה → איסוף פרטים בשיחה (שם הבת, גיל, סניף, שם וטלפון ההורה),
   ואז יצירת student עם status='pending', source='whatsapp',
   tuition_total = default_tuition של הסניף, וקישור ל-conversation.
   התראה לבעלים: "ליד חדש: {שם}, {סניף}".
```

**System prompt לסוכן הלקוחות:**

```
את העוזרת הוירטואלית של "החוג של הניה טייכטל" — חוג משחק, דרמה ומחול לבנות בישראל.
את עונה בוואטסאפ להורים, בעברית, בחום ובקצרה (עד 3 משפטים), עם אימוג'י אחד לכל היותר.

חוקים מוחלטים:
1. עני אך ורק על סמך מאגר השאלות המצורף. אל תמציאי מידע, מחירים, סניפים או מועדים.
2. אם התשובה לא נמצאת במאגר: "זו שאלה טובה שאין לי עליה תשובה מדויקת — אני מעבירה
   אותה להניה והיא תחזור אלייך בהקדם 🙏" ותו לא.
3. אל תבטיחי הבטחות ואל תאשרי הנחות או מקומות בקבוצה.
4. אם ההורה מעוניינת להירשם — אספי: שם הבת, גיל, סניף מבוקש, שם וטלפון ההורה.
   שאלי שאלה אחת בכל הודעה, לא שאלון.
5. פנייה בלשון נקבה. סגנון חם, מכבד ותמציתי.
```

### 4.5 Cron

| Job | תזמון | פעולה |
|---|---|---|
| `cron-lessons` | 02:00 יומי | יצירת `lessons` למחר לכל סניף פעיל לפי `weekdays` |
| `cron-reminders` | כל 15 דקות | שליחת `reminders` ש‑`scheduled_at <= now()` דרך `wa-send` |
| `cron-debt` | 08:30 יומי | לכל תלמידה עם `balance>0` שעברו 30/60/90 יום מהתשלום האחרון — יצירת תזכורת `debt_reminder` (פעם אחת לכל סף) |
| `cron-attendance-watch` | כל 30 דקות | שיעור ב‑`pending` שעברו `attendance_nudge_minutes` משעת השיעור → `supervisor_nudge`; עברו 4 שעות → התראה לבעלים |
| `cron-absence` | 20:00 יומי | תלמידה עם `absence_alert_streak` היעדרויות רצופות → התראה לבעלים + הצעת `absence_alert` להורה |
| `cron-daily-summary` | לפי `daily_summary_time` | `owner_daily` לבעלים |
| `cron-weekly-summary` | ראשון 09:00 | `owner_weekly` לבעלים |
| `cron-recurring` | 01:00 ב‑1 לחודש | שכפול `ledger_entries` עם `is_recurring=true` לחודש הנוכחי |
| `cron-wa-health` | כל 10 דקות | `GET /api/health`; שני כשלים רצופים → עצירת התור והתראה בערוץ עצמאי |

כל job מכבד `quiet_hours` ואינו שולח בשבת ובחגים (טבלת `holidays` פשוטה עם תאריכים; ב‑seed הכניסו את חגי תשפ״ז).

---

## 5. מסכים — מפרט מלא

ניווט: דסקטופ — סרגל צד ימני קבוע. מובייל — סרגל תחתון נגלל אופקית. כל מסך נטען עם skeleton, מציג מצב ריק מנוסח בעברית, ותופס שגיאות ל‑toast.

### 5.1 `/` דשבורד
* ארבעה KPI: הכנסות העונה · הוצאות העונה · רווח · חוב פתוח (עם מספר החייבות).
* באנר אדום כאשר יש שיעורים ללא דיווח נוכחות היום, עם קישור ישיר.
* טבלת רווחיות לפי סניף (מ‑`v_branch_pnl`), שורה לחיצה → מסך הסניף.
* כרטיס "החייבות הגדולות" — 5 שורות עם כפתור תזכורת מיידי.
* ציר זמן "מה קרה היום" מ‑`audit_log` + `wa_messages` (10 אירועים אחרונים).
* בורר עונה בראש המסך, משפיע על כל המסכים.

### 5.2 `/branches` · `/branches/:id`
רשימת כרטיסים: שם, סטטוס, כתובת, ימים ושעות, אחראית וטלפון, מספר תלמידות, חוב פתוח, רווח.
מסך סניף: טאבים — סקירה · תלמידות · גבייה · הוצאות · נוכחות · הגדרות.
בהגדרות: מחיר ברירת מחדל, שכירות, ימי פעילות, פרטי אחראית, **כפתור "קישור נוכחות"** (העתקה, שליחה בוואטסאפ, ביטול והנפקה מחדש).

### 5.3 `/students`
טבלה עם חיפוש חופשי, סינון לפי סניף וסטטוס, מיון לפי כל עמודה.
עמודות: שם · סניף · כיתה · הורה · טלפון · אמורה · שילמה · יתרה · סטטוס · נוכחות %.
פעולות: הוספה, ייבוא אקסל (מיפוי עמודות + תצוגה מקדימה + דוח שגיאות), ייצוא.
**כרטיס תלמידה** (מגירה צדדית): פרטים אישיים · מצב תשלומים עם פס התקדמות והיסטוריה · היסטוריית נוכחות · השתתפות בהפקות · הודעות שנשלחו · הערות. כפתורים: רישום תשלום · שליחת תזכורת · קביעת מעקב · הפסקת השתתפות.

### 5.4 `/collection` גבייה
שלושה KPI: נגבה · נותר · אחוז גבייה.
טבלת חייבות ממוינת לפי גובה החוב, עם ותק חוב צבעוני (30/60/90).
בחירה מרובה → "שליחת תזכורת לנבחרות" עם תצוגה מקדימה של ההודעה לפני שליחה.

### 5.5 `/expenses` הוצאות
סינון לפי סניף, קטגוריה וטווח תאריכים. גרף עוגה לפי קטגוריה.
טופס הוספה מהיר בראש המסך + העלאת צילום חשבונית (Storage, דחיסה ל‑1600px).
סימון "הוצאה קבועה" יוצר רשומה חוזרת.

### 5.6 `/general` כספים כלליים
טבלת הכנסות והוצאות ללא שיוך לסניף, כל שורה עם בורר שיטת חלוקה.
מתחת: טבלת "השפעת החלוקה" — כמה מוקצה לכל סניף.

### 5.7 `/productions` הפקות
כרטיס לכל סרט עם פס תקציב מול ביצוע.
מסך הפקה: טבלת הוצאות, טבלת הכנסות, רווח, ומשתתפות (בורר תלמידות שחוסם ללא אישור צילום).

### 5.8 `/attendance` נוכחות
כרטיס לכל סניף עם סטטוס דיווח היום וכפתורי "פתיחת הקישור" ו"שליחה לאחראית".
יומן שיעורים עם אחוזי הגעה. דוח נוכחות פר תלמידה. באנר התראות נשירה.

### 5.9 `/a/:token` — מסך האחראית (ציבורי, ללא התחברות)
מסך יחיד, מובייל, ללא ניווט:
כותרת עם שם הסניף והתאריך → רשימת שמות עם שלושה כפתורים (הגיעה / איחרה / לא הגיעה) → "סימון הכל כהגיעו" → מונה "X מתוך Y סומנו" → כפתור שמירה גדול.
אחרי שמירה: מסך תודה. חזרה לקישור באותו יום מציג את הסימון הקיים וניתן לעדכון עד חצות.
טוקן לא תקין → "הקישור אינו פעיל, פני לניהול".

### 5.10 `/reminders` תזכורות
טופס קביעת תזכורת עתידית (נמען, תאריך, תבנית, טקסט עם משתנים, תצוגה מקדימה).
רשימת אוטומציות פעילות עם מתגי הפעלה (כתיבה ל‑`settings`).
יומן שליחות עם סינון וסטטוס מסירה.
עורך תבניות עם רשימת המשתנים הזמינים.

### 5.11 `/agent` סוכן AI
סימולטור צ'אט לבדיקה (מריץ `ai-answer` באמת מול המאגר).
מסך שיחות אמיתיות עם היסטוריה ומתג "השתלטות אנושית".
מסך מאגר שאלות: הוספה, עריכה, מילות מפתח, מונה שימוש.
מסך "שאלות שלא נענו" עם כפתור "הפוך לתשובה במאגר".

### 5.12 `/commands` פקודות וואטסאפ
* צ'אט בדיקה שמריץ את `ai-command` האמיתי (כולל שלב האישור).
* ניהול מספרים מורשים: הוספה, רמת הרשאה, שיוך לסניף, השבתה.
* יומן פקודות: מי · מה נכתב · מה בוצע · סטטוס · כפתור ביטול לפעולות מ‑24 השעות האחרונות.
* ניסיונות שנדחו מסומנים באדום.

### 5.13 `/reports` דוחות
רווח והפסד (עונה/חודש) · רווחיות לפי סניף לפני ואחרי הקצאה · גבייה · נוכחות · נשירה · רווח לפי הפקה · המרת פניות לתלמידות.
כל דוח: גרף + טבלה + ייצוא ל‑CSV ול‑PDF.

### 5.14 `/settings` הגדרות
משתמשים והרשאות · עונות · קטגוריות · תבניות · שעות שקטות וחגים · פרטי חיבור וואטסאפ עם בדיקת חיבור · גיבוי וייצוא מלא.

---

## 6. עיצוב

```css
--paper:#F6F4F8; --card:#FFFFFF; --ink:#241A2E; --soft:#6B5D78;
--plum:#5B2A57;  --rose:#B03A62;  --sage:#5F7458; --amber:#B07A22;
--rule:#E1D9E6;  --shade:#F0EAF3; --nav:#2E1F3D;
--ok:#3F7D4E; --warn:#B07A22; --bad:#B33A3A;
```
מצב כהה: `#141020` רקע, `#1E1830` כרטיסים, `#EDE7F2` טקסט, ורוד `#EC7FA1`.

* גופנים: **Heebo** לכל הטקסט, **Frank Ruhl Libre** לכותרות ולמספרים גדולים.
* פינות: 10px לכרטיסים, 7px לשדות, 8px לכפתורים.
* צל אחד בלבד: `0 8px 24px rgba(36,26,46,.10)`, רק על מודלים ותפריטים.
* מובייל‑פירסט. נקודת שבירה 860px.
* כל טבלה עטופה ב‑`overflow-x:auto`.
* חובה: פוקוס מקלדת נראה, `prefers-reduced-motion`, ניגודיות AA.

---

## 7. Seed

`supabase/seed.sql` יוצר: עונה נוכחית · 5 סניפים (ביתר עילית, מודיעין עילית, ירושלים רמות, בית שמש, אשדוד) · 21 תלמידות עם מצבי תשלום מגוונים (שילמו הכל, חלקי, לא שילמו כלל, אחת שהפסיקה, אחת ממתינה) · תשלומים · 14 הוצאות סניף · 5 רשומות כלליות עם שיטות חלוקה שונות · 3 הפקות (אחת בעריכה, שתיים שהופצו ורווחיות) · שיעורי נוכחות שבועיים חודש אחורה כולל שיעור אחד שלא דווח ותלמידה אחת עם 3 היעדרויות רצופות · 10 שאלות במאגר · 2 שאלות ללא מענה · 3 מספרים מורשים · 7 תבניות הודעה · כל ערכי ה‑settings.

---

## 8. סדר בנייה ותנאי קבלה

### שלב 1 — יסודות ונתונים
מיגרציה מלאה, RLS, seed, Auth, פריסת ניווט, דשבורד, סניפים, תלמידות, כרטיס תלמידה, תשלומים, גבייה, הוצאות, כספים כלליים.
**קבלה:** התחברות כבעלים מציגה 5 סניפים ו‑21 תלמידות · התחברות כמנהלת סניף מציגה סניף אחד בלבד · רישום תשלום מעדכן יתרה ודשבורד מיידית · חלוקת הוצאה כללית מזיזה את הרווח בדוח.

### שלב 2 — נוכחות
טבלאות, יצירת שיעורים אוטומטית, הנפקת טוקנים, מסך `/a/:token`, יומן, דוחות, התראות נשירה.
**קבלה:** פתיחת קישור בגלישה פרטית מאפשרת סימון ושמירה ללא התחברות · הטוקן לא חושף טלפונים או כספים · טוקן מבוטל מציג הודעת שגיאה · דיווח מעדכן את הדשבורד.

### שלב 3 — וואטסאפ יוצא
`wa-send`, תבניות, תזכורות ידניות, cron של גבייה ונוכחות, סיכומים לבעלים, יומן שליחות, שעות שקטות, `cron-wa-health`.
**קבלה:** תזכורת מהמסך מגיעה למכשיר אמיתי · הודעה שנקבעת בשעה חסומה נדחית אוטומטית לבוקר · יומן מציג `queued/sent/failed` (אין `delivered` — לשרת אין אירוע מסירה) · ניתוק השרת מעלה באנר ועוצר את התור בלי לסמן תזכורות כנשלחו.

### שלב 4 — סוכן פקודות
`wa-webhook` עם נתב, `ai-command`, זרימת אישור, ביצוע, ביטול, מספרים מורשים, יומן, מסך `/commands`.
**קבלה:** "שילמתי 860 תלבושות בביתר" מוצג לאישור ואחרי "כן" מופיע בהוצאות ביתר · "מי חייבת בביתר" מחזיר רשימה מיידית בלי אישור · "בטל" מוחק את הפעולה האחרונה · מספר לא מורשה נדחה ומייצר התראה · שגיאת פרסור לא כותבת כלום למסד.

### שלב 5 — סוכן הלקוחות
`ai-answer`, מאגר שאלות, שאלות ללא מענה, איסוף לידים, מסך שיחות, השתלטות אנושית.
**קבלה:** שאלה שבמאגר נענית נכון · שאלה שאינה במאגר לא מקבלת המצאה, נרשמת, ומייצרת התראה · שיחת הרשמה יוצרת תלמידה בסטטוס ממתינה · הסוכן אינו נוקב במחיר כל עוד `agent_may_quote_prices=false`.

### שלב 6 — הפקות, דוחות, ליטוש
מודול הפקות, כל הדוחות עם ייצוא, ייבוא אקסל, גיבוי, מצב כהה, ליטוש מובייל.
**קבלה:** רווח לכל הפקה מחושב נכון · כל דוח מייצא CSV תקין · ייבוא של 50 שורות עובר עם דוח שגיאות · המערכת שמישה מלאה בטלפון.

---

## 9. איכות — חובה בכל שלב

* TypeScript strict. אין `any`. טיפוסי מסד נוצרים ב‑`supabase gen types`.
* כל סכום עובר דרך `formatILS()` יחיד. אין חישוב כספי ב‑JSX.
* כל קריאת רשת עטופה ב‑React Query עם מצבי טעינה ושגיאה.
* כל כתיבה מוגנת ב‑Zod לפני שליחה.
* כל פעולה הרסנית עם דיאלוג אישור.
* Edge Functions: אימות קלט, try/catch, לוג שגיאה, ולעולם לא להחזיר שגיאה גולמית למשתמש בוואטסאפ — תמיד ניסוח אנושי בעברית.
* אף מפתח API לא נוגע ב‑frontend. `ANTHROPIC_API_KEY`, `WA_API_KEY` ו‑`WA_WEBHOOK_SECRET` חיים רק ב‑Edge Functions.
* בדיקות: יחידה לחישובי יתרה וחלוקה, ואינטגרציה לזרימת הפקודות מקצה לקצה.
