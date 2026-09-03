# העלאה לאוויר

## מה צריך ממך

| ערך | מאיפה |
|---|---|
| `SUPABASE_PROJECT_REF` | supabase.com ← Settings ← General ← Reference ID |
| `SUPABASE_DB_PASSWORD` | הסיסמה שנקבעה ביצירת הפרויקט |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | Settings ← API |
| `SUPABASE_DB_URL` | Settings ← Database ← Connection string ← URI |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | Google Cloud ← APIs & Services ← Credentials ← OAuth client (Web). Redirect URI: `https://<ref>.supabase.co/auth/v1/callback` |
| `NETLIFY_AUTH_TOKEN` · `NETLIFY_SITE_ID` | אופציונלי. בלעדיהם `dist/` נגרר ידנית. `NETLIFY_SITE_ID` הוא המזהה (UUID), לא השם |
| `WA_SERVER_URL` · `WA_API_KEY` | שרת ה-whatsapp-hub |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

```bash
cp .env.verify.example .env.verify   # ומלא
./scripts/deploy.sh
```

## הסדר, ולמה הוא לא שרירותי

0. **בדיקות** — `tsc` וכל החבילות. קוד שנופל לא נפרס.
1. **מיגרציות** — 13, על פרויקט נקי.
2. **seed והבעלים הראשונה** — `db push` אינו מריץ seed. בלעדיו הפרונט
   עולה מול מסד ריק ונראה שבור, ואין דרך לדעת שזו רק סדר.
   `seed_allowlist.sql` רץ תמיד: בלי בעלים ברשימת המורשים אין מי שיכנס.
3. **Edge Functions** — הסודות לפני הפריסה, אחרת הפונקציה הראשונה
   שתיקרא תיפול על משתנה חסר.
4. **פרונט** — אחרון.

## כשפורט 5432 חסום — Management API

יש סביבות (סנדבוקס של סוכן, CI מוגבל) שבהן יוצא רק HTTPS. שם psql
ו-pg לא מגיעים למסד גם עם מחרוזת חיבור נכונה, ו-`supabase link` לא
מוריד את הבינארי שלו. המסלול השלישי מריץ את אותם קבצים דרך
ה-Management API, עם Personal Access Token
(supabase.com ← Account ← Access Tokens, מתחיל ב-`sbp_`):

```
SUPABASE_PROJECT_REF=...
SUPABASE_ACCESS_TOKEN=sbp_...
```

| מה | איך |
|---|---|
| נעילת יעד | `GET /v1/projects/{ref}` חייב להחזיר את ה-ref המדויק, פעיל |
| מפתח anon | נמשך מ-`api-keys` — לא מועתק ידנית |
| הרשמה עצמית | `disable_signup=true` נקבע בקוד (`scripts/supabase-project.mjs auth`) |
| מיגרציות | `scripts/db-push-api.mjs` — כל מיגרציה + הרישום שלה בשאילתה אחת, אטומית |
| seed | `db-push-api.mjs seed` — רק כשאין סניפים |
| חבילות SQL | `supabase/tests/run-cloud-api.mjs` — אותם קבצים, עם חיקוי של `\set`/`\ir` |

מה שהמסלול הזה **לא** נותן, ונאמר במפורש בפלט:

* `RAISE NOTICE` אינו מוחזר. ✓ של assert לא נראה; assert שנכשל מרים
  חריגה והחבילה נופלת עם ההודעה. "עברה" = אף חריגה.
* מרוץ האישורים (`command-race.test.mjs`) דורש שני חיבורים חיים
  במקביל. הוא מדולג ומדווח כמדולג. רץ מקומית וב-CI.
* Edge Functions נפרסות עם ה-CLI בלבד. זה שלב 3 של `deploy.sh`, לא
  של סבב האימות.

הטוקן הוא סוד ברמת החשבון — כל פרויקט בו. `check-secrets.mjs` עוצר
בילד שמכיל אותו. המריץ אומת מול פוסטגרס מקומי (`PGURL=…`) לפני
שנגע בענן, כולל בקרת שלילה שמפילה חבילה אחת בלי לגרור את השאר.

## לפני מסירה ללקוחה

1. `npm run seed:identities:purge` — מוחק את שלוש זהויות הבדיקה
   (`@teichtal.local`). הן לא יכולות להיכנס ממילא, אבל אין להן מקום
   ברשימת המורשים של הלקוחה.
2. לוודא שהבעלים של הלקוחה מוזמנת במסך המשתמשים **וגם** נוספה כ-test
   user ב-Google Cloud (ראה README, "הוספת משתמשת דורשת שתי פעולות").

## דגלי הרצה יבשה נשארים דולקים

`WA_DRY_RUN=true` ו-`AI_DRY_RUN=true` הם ברירת המחדל גם בפריסה.
המערכת עולה מלאה, אבל **אף הודעת וואטסאפ לא יוצאת ואף קריאה
ל-Claude לא נעשית** עד שהחלטה מפורשת תשנה אותם.

המעבר לחי הוא צעד נפרד, אחרי סבב האימות:

```bash
npx supabase secrets set WA_DRY_RUN=false
npx supabase secrets set AI_DRY_RUN=false
```

## מה שהפריסה חושפת ואי אפשר לבדוק מקומית

* **ניתוב SPA.** `netlify.toml` מחזיר את `index.html` לכל נתיב.
  בלעדיו `/a/:token` — הקישור שהאחראית מקבלת בוואטסאפ — מחזיר 404.
* **משתנה סביבה שנשכח.** במקום מסך לבן, המערכת מציגה מסך "המערכת
  אינה מוגדרת" עם השורות החסרות.
* **שגיאת render.** `ErrorBoundary` מציג הודעה וכפתור רענון במקום
  דף ריק.

## סודות בצד הלקוח — שער בבילד

כל מה שמתחיל ב-`VITE_` נארז לקוד הדפדפן וגלוי לכל מי שפותח את הדף.
`npm run build` נעצר אם משהו דלף — לפני הבילד (שמות וערכי משתנים)
ואחריו (סריקת `dist/`):

* משתנה `VITE_` ששמו מרמז על סוד (`SERVICE_ROLE`, `SECRET`, `ANTHROPIC`…)
* **ערך** שהוא JWT עם `role=service_role` — גם אם השם תמים
* מפתח בתבנית `sk-ant-`
* אותם דברים בתוך `dist/` — תופס גם הטמעה ידנית בקוד

אומת בארבע בקרות שלילה. `service_role` ו-`ANTHROPIC_API_KEY` חיים רק
כסודות של Edge Functions.

## הכתובת החיה מוגנת

`npm run test:public` מאמת שהמשטח הציבורי הוא דף אחד:

* מסלול אחד בלבד מחוץ ל-`AuthProvider`, והוא `/a/:token`
* המסלול `*` עוטף את `AuthProvider` — בלעדיו כל השאר חשוף
* דף האחראית ניגש דרך שתי RPC בלבד, לא נוגע באף טבלה
* גוגל בלבד: ספק האימייל כבוי בקונפיג, ואף קריאת כניסה בסיסמה לא קיימת בקוד
* `Gate` חוסם פרופיל חסר או מושבת, ומסך המשתמשים קיים רק לבעלים

`config.toml` היא הגדרה מקומית. **ההגדרה המחייבת בפרויקט מתארח היא
בדשבורד** — Authentication ← Providers. `scripts/supabase-project.mjs auth`
קובע אותה בקוד (אימייל כבוי, גוגל דולק, כתובות החזרה), ו-`verify-access.mjs`
מנסה בפועל להירשם, להיכנס בסיסמה וליצור חשבון לאימייל זר — ונכשל אם
משהו מזה מצליח, כי זו הדרך היחידה לדעת.

## אחרי הפריסה

```bash
./scripts/verify-cloud.sh
```

ששת שלבי האימות. עד שהם עוברים, המערכת באוויר אבל לא מאומתת.
