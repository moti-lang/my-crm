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
supabase db push               # מחיל מיגרציות על הפרויקט המרוחק
npm run db:reset               # מקומי: בונה מאפס + seed + משתמשים
```

**משתמשים לא נוצרים ב-SQL.** כתיבה ישירה ל-`auth.users` מייצרת משתמש שנראה תקין
בטבלה אבל לא מצליח להתחבר — GoTrue דורש שורה תואמת ב-`auth.identities`, והסכמה
משתנה בין גרסאות. לכן `seed.sql` מכיל נתונים עסקיים בלבד, ואת המשתמשים יוצר:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:users
```

הסקריפט אידמפוטנטי, וגם כותב `profiles`, משייך `branch_staff` וממלא `created_by`.

| קובץ | תוכן |
|---|---|
| `supabase/migrations/0001_init.sql` | enums, טבלאות, אינדקסים, views, `f_general_allocation` |
| `supabase/migrations/0002_rls.sql` | RLS על כל טבלה, פוליסות, תצוגת רואת חשבון |
| `supabase/migrations/0003_allocation_largest_remainder.sql` | חלוקת הוצאות בשיטת השארית הגדולה |
| `supabase/seed.sql` | עונה, 5 סניפים, 21 תלמידות, תשלומים, כספים, הפקות, נוכחות, תבניות, הגדרות |

### אימות בלי Supabase חי

הריפו מריץ את כל הסכמה על פוסטגרס מקומי, כדי שאפשר יהיה לאמת בלי לחכות למפתחות:

```bash
npm run db:reset:local     # בונה מאפס: shim + מיגרציות + seed + משתמשי בדיקה
npm run db:test            # הוכחת RLS + הוכחת חלוקת הוצאות
npm run db:test:negative   # בקרת שלילה: פותח כל חור ומוודא שהחבילה נופלת
```

`supabase/tests/00_local_auth_shim.sql` מחקה את סכמת `auth` של Supabase, ו-`01_local_users.sql`
ממלא את מקום `seed-users.mjs` היכן שאין GoTrue. שניהם **לא** מיגרציות ולא רצים בפרודקשן.

## הוכחת ה-RLS

`02_rls_proof.sql` מריץ שאילתות ישירות בתור `authenticated` עם JWT claims אמיתיים —
בדיוק כמו supabase-js — ומוודא שההפרדה בין הסניפים נאכפת **במסד**, לא בפילטר בצד הלקוח.
כולל קטגוריית הסלמת הרשאות: ניסיון של מנהלת סניף להפוך את עצמה ל-owner, לשייך את עצמה
לסניף אחר, או להוסיף מספר מורשה לפקודות וואטסאפ.

`03_allocation_proof.sql` מוודא ש-`sum(allocated) = amount` בדיוק, לכל שיטות החלוקה
ולכל סכום, כולל 12,000 ש"ח לשבעה סניפים.

`negative-control.sh` פותח כל חור בנפרד ומוודא שהחבילה נופלת עליו. בדיקה שתמיד עוברת
אינה מוכיחה דבר.

## בדיקות אבטחה — כלל מחייב

**בדיקת אבטחה מוכיחה את ההרשאה או את המצב, לא את קוד השגיאה.**

הכלל הזה נלמד פעמיים, בשני סבבים שונים, כששתי סיבות שונות החזירו
SQLSTATE זהה ובדיקה דיווחה ✓ בטעות:

| הבדיקה | מה חשבנו שהיא בודקת | מה באמת קרה |
|---|---|---|
| מנהלת משנה את התפקיד שלה ל-owner | RLS חוסם | `permission denied for schema auth` — פגם ב-shim |
| anon חסום מ-`students` | אין GRANT | `permission denied for function my_branches` |

שתיהן `42501`. בדיקה שתפסה `insufficient_privilege` עברה בשני המקרים.

הצורות המותרות, ב-`supabase/tests/_assert.sql`:

* `assert_no_effect(label, action, probe)` — מריץ את הפעולה האסורה, בולע
  כל שגיאה, ומוכיח ש**המצב לא השתנה**. לא משנה למה היא נחסמה; משנה
  שהיא לא קרתה. המסר מדווח גם *איך* נחסם (`נחסם (42501)` או `ללא שגיאה`).
* `assert_no_table_privilege(role, tables[])` — ברמת ה-GRANT, על ארבע
  הפעולות. grant שנוסף בטעות נתפס גם אם RLS במקרה מסתיר את השורות.
* `assert_no_execute(role, signature)` — הרשאת הרצה על פונקציה.

`grep "exception when insufficient_privilege" supabase/tests/*.sql` חייב
לחזור ריק.

## סבב האימות מול הענן

```bash
cp .env.verify.example .env.verify   # ומלא
./scripts/verify-cloud.sh            # ששת השלבים, עצירה בכשל הראשון
./scripts/verify-cloud.sh 3          # שלב בודד
```

| שלב | מה נבדק |
|---|---|
| 1 | `db push` — 13 מיגרציות על פרויקט נקי |
| 2 | `seed:users` — יצירת משתמשים דרך ה-Admin API |
| 3 | התחברות בשלושת התפקידים מול GoTrue, עם JWT אמיתי |
| 4 | כל חבילות ה-SQL מול הענן — אותם קבצים, יעד אחר |
| 5 | רישום webhook והודעת וואטסאפ אחת שיוצאת |
| 6 | `bench:model` — 30 פקודות מול שני מודלים |

זהות המשתמשים בבדיקות נפתרת לפי **תפקיד** (`t_user('owner')`) ולא לפי
UUID קשיח, כי GoTrue מייצר UUID משלו. בדיקה שנועלת UUID הייתה נופלת
בענן על סיבה טפלה ומסתירה את מה שבאמת נבדק.

## עקביות דוחות כספיים — כלל מחייב

`05_role_consistency_proof.sql` מוודא שכל דוח כספי מחזיר **אותם מספרים** לבעלים
ולרואת חשבון. אם השניים רואים מספרים שונים לאותו דוח — זה באג בהגדרה.

שני באגים אמיתיים נתפסו כך:

| מה | מה רואת החשבון ראתה | מה שהיה נכון |
|---|---|---|
| חלוקת הוצאות כלליות | 8,400 | 12,000 |
| הכנסות מתלמידות | 0 | 20,700 |
| חוב פתוח | 0 | 20,600 |

שניהם מאותו שורש: **דוח כספי שנשען על RLS של טבלה שמכילה מידע אישי.**
לרואת חשבון אין גישה ל-`students` בכוונה, ולכן כל דוח שקורא ממנה דרך
`security_invoker` החזיר לה אפסים — לא חסרים, אלא שגויים ומוצגים כנכונים.

**הכלל:** דוח כספי לא נשען על RLS של טבלה עם מידע אישי. הסינון נכתב במפורש
בתצוגה, והמידע האישי ממוסך לפי תפקיד (`v_debtors.parent_phone` מוחזר `null`
לרואת חשבון — אותם סכומים, בלי טלפונים).

**כל דוח כספי חדש מקבל שורה בקובץ הזה.** גם דוחות הסבבים הבאים —
רווח והפסד, נשירה, רווח לפי הפקה, המרת פניות.

הבדיקה מוגנת מפני עצמה: `p_min_owner` מוודא שהבעלים מקבל ערך משמעותי,
כדי שהשוואה בין שני אפסים לא תיחשב הצלחה. בקרת שלילה מרוקנת את
`payments` ומוודאת שהבדיקה נופלת ולא עוברת.

## משתמשי בדיקה (seed)

| אימייל | תפקיד | רואה |
|---|---|---|
| `hania@teichtal.local` | בעלים | הכל |
| `beitar@teichtal.local` | מנהלת סניף | ביתר עילית בלבד |
| `books@teichtal.local` | הנהלת חשבונות | קריאה, בלי טלפונים וכתובות |

סיסמה לכולם: `Teichtal!2026`. נוצרים ע"י `npm run seed:users`.

## טיפוסי מסד

```bash
npm run gen:types
```

⚠️ `scripts/gen-types.mjs` הוא **פתרון ביניים**: `supabase gen types` דורש דוקר שאינו זמין
בסביבת הפיתוח הנוכחית. ברגע שנתחבר לפרויקט Supabase אמיתי — המחולל נמחק ו-`gen:types`
יצביע על ה-CLI הרשמי. שני מקורות טיפוסים זה באג שמחכה לקרות.

## וואטסאפ ו-AI

ברירת המחדל היא הרצה יבשה. ראה `supabase/functions/README.md`.
