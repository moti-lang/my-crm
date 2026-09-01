# מערכת הניהול של החוג של הניה טייכטל

React + Vite + TypeScript · Supabase (Postgres, Auth, Edge Functions) · Tailwind RTL

## הפעלה ראשונה

```bash
npm install
cp .env.example .env.local     # מלאי URL ו-anon key מהפרויקט ב-Supabase
npm run dev
```

`.env.local` ב-`.gitignore`. **מפתח `service_role` לעולם לא נכנס לריפו ולעולם לא לפרונט** —
הוא נקבע כסוד של Edge Functions בלבד:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

## מסד הנתונים

כל שינוי סכמה עובר במיגרציה תחת `supabase/migrations/`. **אין עריכה ידנית בדשבורד של Supabase.**

```bash
supabase link --project-ref <ref>
supabase db push          # מחיל מיגרציות על הפרויקט המרוחק
supabase db reset         # מקומי: בונה מאפס + seed
```

| קובץ | תוכן |
|---|---|
| `supabase/migrations/0001_init.sql` | enums, טבלאות, אינדקסים, views, `f_general_allocation` |
| `supabase/migrations/0002_rls.sql` | RLS על כל טבלה, פוליסות, תצוגת רואת חשבון |
| `supabase/seed.sql` | עונה, 5 סניפים, 21 תלמידות, תשלומים, כספים, הפקות, נוכחות, תבניות, הגדרות |

### אימות בלי Supabase חי

הריפו מריץ את כל הסכמה על פוסטגרס מקומי, כדי שאפשר יהיה לאמת בלי לחכות למפתחות:

```bash
npm run db:reset:local    # בונה מאפס: shim + מיגרציות + seed
npm run db:test           # מריץ את הוכחת ה-RLS
```

`supabase/tests/00_local_auth_shim.sql` מחקה את סכמת `auth` של Supabase. הוא **לא** מיגרציה
ולא רץ בפרודקשן.

## הוכחת ה-RLS

`supabase/tests/01_rls_proof.sql` מריץ שאילתות ישירות בתור `authenticated` עם JWT claims אמיתיים —
בדיוק כמו supabase-js — ומוודא שההפרדה בין הסניפים נאכפת **במסד**, לא בפילטר בצד הלקוח.

הבדיקה נכשלת בקול רם אם נפער חור. בקרת שלילה: `alter table students disable row level security`
מפילה אותה מיד.

## משתמשי בדיקה (seed)

| אימייל | תפקיד | רואה |
|---|---|---|
| `hania@teichtal.local` | בעלים | הכל |
| `beitar@teichtal.local` | מנהלת סניף | ביתר עילית בלבד |
| `books@teichtal.local` | הנהלת חשבונות | קריאה, בלי טלפונים וכתובות |

סיסמה לכולם: `Teichtal!2026`

## וואטסאפ ו-AI

ברירת המחדל היא הרצה יבשה. ראה `supabase/functions/README.md`.
