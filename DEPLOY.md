# העלאה לאוויר

## מה צריך ממך

| ערך | מאיפה |
|---|---|
| `SUPABASE_PROJECT_REF` | supabase.com ← Settings ← General ← Reference ID |
| `SUPABASE_DB_PASSWORD` | הסיסמה שנקבעה ביצירת הפרויקט |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | Settings ← API |
| `SUPABASE_DB_URL` | Settings ← Database ← Connection string ← URI |
| `NETLIFY_AUTH_TOKEN` · `NETLIFY_SITE_ID` | אופציונלי. בלעדיהם `dist/` נגרר ידנית |
| `WA_SERVER_URL` · `WA_API_KEY` | שרת ה-whatsapp-hub |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

```bash
cp .env.verify.example .env.verify   # ומלא
./scripts/deploy.sh
```

## הסדר, ולמה הוא לא שרירותי

0. **בדיקות** — `tsc` וכל החבילות. קוד שנופל לא נפרס.
1. **מיגרציות** — 13, על פרויקט נקי.
2. **seed ומשתמשים** — `db push` אינו מריץ seed. בלעדיו הפרונט
   עולה מול מסד ריק ונראה שבור, ואין דרך לדעת שזו רק סדר.
3. **Edge Functions** — הסודות לפני הפריסה, אחרת הפונקציה הראשונה
   שתיקרא תיפול על משתנה חסר.
4. **פרונט** — אחרון.

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
* `enable_signup = false`

`config.toml` היא הגדרה מקומית. **ההגדרה המחייבת בפרויקט מתארח היא
בדשבורד** — Authentication ← Providers ← Email ← Allow new users to
sign up. `verify-login.mjs` מנסה להירשם בפועל ונכשל אם זה מצליח,
כי זו הדרך היחידה לדעת.

## אחרי הפריסה

```bash
./scripts/verify-cloud.sh
```

ששת שלבי האימות. עד שהם עוברים, המערכת באוויר אבל לא מאומתת.
