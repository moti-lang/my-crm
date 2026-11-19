# ביקורת והקשחת אבטחה — 11/2026

המערכת: teichtal-crm (Netlify + Supabase `kzoxlusbocxjinfxckhe`). מחזיקה נתוני קטינות ותשלומים.
התיקונים במיגרציות 0052–0057, ב-`netlify.toml`, ב-`_shared/guard.ts` וב-`Collection.tsx`.
הבדיקות שלהם: `supabase/tests/34_security_hardening.sql`, `supabase/tests/security-headers.test.mjs`
ו-17 בקרות שלילה חדשות ב-`negative-control.sh`.

## מה נבדק

| תחום | איך נבדק | תוצאה לפני התיקון |
|---|---|---|
| טבלאות (37) | RLS, policies והרשאות anon/authenticated בענן | RLS פעיל בכל 37. ל-anon אין שום הרשאה. אין `USING (true)`. כל policy תלויה ב-`auth_role()` |
| views (18) | `security_invoker`, הרשאות, האם ניתן לעדכן דרכם | 16 רצו כבעלים. ל-authenticated היה ALL על כולם. **שניים ניתנים לעדכון → עקיפת RLS** |
| פונקציות (127) | SECURITY DEFINER, search_path, מי מריץ. כל פונקציה הורצה כמשתמשת בלי תפקיד | 7 פתוחות ל-anon (6 בכוונה ואחת בטעות). 17 בלי search_path. **2 עם בדיקת תפקיד שבה NULL עובר**. אחת מדליפה נתונים כספיים |
| Storage | buckets ו-policies | 2 buckets (`backups` ו-`deploy`). שניהם פרטיים ואין policies (רק השרת ניגש) |
| Edge Functions (26) | verify_jwt, שומר בקוד, חתימות webhook, CORS | כל 16 בלי verify_jwt מוגנות: סוד cron, HMAC של ה-Hub, Svix של Resend, סוד משותף של SUMIT או טוקן. CORS מוגבל לאתר. השוואת סוד ה-cron לא בזמן קבוע |
| Netlify Functions | — | אין |
| Auth | הגדרות בענן וטריגר `auth_user_gate` | גוגל בלבד (אימייל, טלפון ואנונימי כבויים). רשימת המורשים נאכפת בשרת: טריגר על `auth.users` מסרב לכל מי שאינו ברשימה |
| ריפו ו-history | חיפוש תבניות של מפתחות בכל ה-history וקבצי .env | אין סודות. רק `.env.example` נכנס ל-git. ההתאמה היחידה (`re_…`) היא חלק ממילה בקובץ ה-API של SUMIT |
| bundle | מחרוזות, JWT ו-source maps | `sb_secret_` הוא קוד של supabase-js (`startsWith("sb_secret_")`), לא מפתח. JWT יחיד, `role: anon`. אין source maps |
| API חי עם anon | GET, ו-PATCH/DELETE עם מסנן שלא תופס אף שורה, על כל 55 הטבלאות וה-views | הכול חסום. **דליפה אחת**: `rpc/t_seed_student_count` החזירה מספר תלמידות |
| כותרות | האתר החי | HSTS, X-Frame-Options, nosniff, Referrer, Permissions — קיימים. **אין CSP** |
| XSS | `dangerouslySetInnerHTML`, `innerHTML`, `href` מנתונים | אין `dangerouslySetInnerHTML`. חלון ההדפסה ממלט הכול. קישור הקבלה של SUMIT הוצג כ-href בלי בדיקה |

## ממצאים ותיקונים

| # | חומרה | מה היה | מה תוקן | איך אומת |
|---|---|---|---|---|
| 1 | גבוה | `v_students_accounting` ו-`v_branch_pnl` רצו כבעלים, ניתנים לעדכון, עם INSERT/UPDATE/DELETE ל-authenticated. רואת חשבון (תפקיד לקריאה בלבד) יכלה לשנות ולמחוק תלמידות, ומשתמשת מושבתת יכלה להוסיף סניף. הסיבה: ברירות המחדל של Supabase, שה-shim המקומי לא שיחזר | 0052: כל view — SELECT בלבד. בלי TRUNCATE/REFERENCES/TRIGGER על טבלאות. ברירות המחדל לאובייקטים חדשים נשללו. ה-shim משחזר עכשיו את ברירות המחדל של Supabase | הוכח מקומית לפני התיקון. אחרי: 34 (נבדקת התוצאה ולא רק קוד השגיאה), ושתי בקרות שלילה מחזירות את החור ונופלות |
| 2 | גבוה | `rpc_close_branch` (`auth_role() <> 'owner'`) ו-`rpc_rename_student` (`not (v_role = …)`). למשתמשת מושבתת `auth_role()` היא NULL, והבדיקה "עוברת": אפשר היה לסגור סניף ריק ולשנות שם של תלמידה | 0053: בדיקות בטוחות ל-NULL. בנוסף `my_branches()` ריקה למשתמשת לא פעילה | 34 (משתמשת מושבתת → 42501, ושום דבר לא השתנה). שתי בקרות שלילה מחזירות את הגוף הישן |
| 3 | בינוני | 16 views עם SECURITY DEFINER (Advisor: ERROR) | 0056: כל view הוא `security_invoker`. הגוף עבר כמו שהוא לפונקציה ב-`private` (לא חשופה ב-API). רואת החשבון ממשיכה לראות דוחות בלי גישה לטבלת התלמידות | פלט כל 18 ה-views זהה לפני ואחרי, לחמישה קוראים: בעלים, מנהלת, רואת חשבון, בלי תפקיד ו-service_role. בדיקה 05 (עקביות בין תפקידים) ובקרת השלילה עליה עודכנו |
| 4 | בינוני | `f_general_allocation` נפתחה ישירות לכל משתמשת מחוברת. החזירה חלוקת הוצאות כלליות לכל הסניפים, גם למנהלת סניף או למושבתת | 0056: ההרשאה נשללה. נקראת רק מתוך ה-view של הבעלים ורואת החשבון | 34 ובקרת שלילה |
| 5 | בינוני | אין Content-Security-Policy | `netlify.toml`: CSP (סקריפטים מהאתר בלבד, חיבורים רק לפרויקט ה-Supabase, `frame-ancestors 'none'`), HSTS מפורש, Permissions-Policy מורחבת ו-COOP | `security-headers.test.mjs`. כל בדיקות המסך רצות עכשיו תחת אותו CSP, והפרה נרשמת כשגיאת דף. בקרת שלילה: CSP שחוסם את האפליקציה מפיל בדיקת מסך. באתר החי — ראו "אימות בענן" |
| 6 | נמוך | `t_seed_student_count()` (נוצרה ידנית בענן, לא בריפו) פתוחה ל-anon | 0054: ההרשאה נשללה. **לא נמחקה** — ממתין לאישור | בדיקת anon חוזרת |
| 7 | נמוך | 17 פונקציות בלי search_path | 0055: `search_path = public, pg_temp` לכולן | 34 ובקרת שלילה |
| 8 | נמוך | בדיקת סוד ה-cron לא בזמן קבוע (`!==`) | `timingSafeEqualStr` | function-guards, בדיקת יחידה ב-Deno ובקרת שלילה |
| 9 | נמוך | קישור הקבלה מ-SUMIT הוצג כ-href בלי בדיקה | `safeHttpsUrl` — רק https | tsc ובדיקות המסך |
| 10 | מידע | `wa_config`: RLS בלי policy (Advisor: INFO). נכון, אבל נראה כמו שכחה | 0057: policy מגבילה מפורשת | 34 ובקרת שלילה |

## מה נשאר פתוח ודורש החלטה

| נושא | למה לא תוקן | המלצה |
|---|---|---|
| מחיקת `t_seed_student_count()` | מחיקה מחכה לאישור | למחוק. כבר נעולה לכולם |
| Advisor: `authenticated_security_definer_function_executable` (WARN) | זה הדפוס של המערכת: RPC שבודקות תפקיד בפנים. כל אחת הורצה כמשתמשת בלי תפקיד ונדחתה | להשאיר, מתועד |
| Advisor: `anon_security_definer_function_executable` (WARN × 6) | הדפים הציבוריים: נוכחות, תשלום, הרשמה, הסרה מתפוצה. ההרשאה היא הטוקן בקישור (64 hex) | להשאיר |
| Advisor: `auth_leaked_password_protection` | שינוי הגדרת Auth. אין כניסה בסיסמה בכלל (גוגל בלבד) | אפשר להדליק, בלי השפעה על משתמשות |
| Advisor: `extension_in_public` (pg_net) | העברה דורשת מחיקה ויצירה מחדש של ההרחבה, ו-cron תלוי בה | להשאיר |
| הטוקן ב-localStorage | כך עובד supabase-js באפליקציה בלי שרת. מעבר ל-cookie httpOnly דורש שרת ביניים | ה-CSP החדש סוגר את הדרך העיקרית לגנוב אותו (סקריפט זר או inline). JWT לשעה עם רוטציה, ויש יציאה אוטומטית |
| משתמשת מושבתת עדיין נכנסת בגוגל (בלי תפקיד) | חסימה ב-Auth (ban) היא שינוי הגדרות Auth | אחרי 0053 אין לה מה לעשות. אפשר להוסיף חסימה ב-Auth בהשבתה |
| 5 בעלים פעילות | החלטה עסקית | לוודא שכולן צריכות הרשאת בעלים, ושלכולן אימות דו-שלבי בחשבון הגוגל |
| `style-src 'unsafe-inline'` ב-CSP | React מצייר `style="…"`, וחלון ההדפסה כותב `<style>` | סיכון נמוך (סגנון, לא סקריפט) |
| ה-webhook של ה-Hub בלי חותמת זמן | אירוע חתום שנלכד אפשר לשדר שוב. הודעה כפולה נחסמת לפי מזהה | אפשר להוסיף חותמת זמן בצד ה-Hub |
| (לא אבטחה) cron-debt ו-cron-summary רואים 0 חייבות | ה-views מסננים לפי תפקיד, ו-service_role בלי תפקיד | לטפל בנפרד, לפני שמדליקים תזכורות חוב |

## אימות בענן (12/11/2026, אחרי הפריסה)

| מה | תוצאה |
|---|---|
| גיבוי לפני הפריסה | `teichtal-2026-11-12-1908.json` — אומתו 39 טבלאות ו-30,888 שורות |
| מיגרציות | 0052–0057 הוחלו. 18 מתוך 18 views ב-`security_invoker` |
| Edge Functions | 11 פונקציות עם השומר החדש נפרסו (10 פונקציות ה-cron ו-wa-send). בלי סוד, עם סוד שגוי או עם סוד קצר — 401. הסוד הנכון עובד (גיבוי אחרי הפריסה: `teichtal-2026-11-12-1910.json`) |
| אתר | ה-bundle החי זהה לבילד. CSP, HSTS, X-Frame-Options, nosniff, Referrer, Permissions ו-COOP קיימים בכל נתיב |
| דפדפן אמיתי מול האתר החי | מסך הכניסה, `/a/`, `/pay/`, `/enroll` ו-`/unsubscribe/`: 0 הפרות CSP ו-0 שגיאות. "כניסה עם Google" מגיעה ל-accounts.google.com |
| anon על ה-API | 55 מתוך 55 טבלאות ו-views חסומים (401/42501). `t_seed_student_count` ו-`f_general_allocation`: 42501. הסכמה `private` לא חשופה (PGRST106). anon מריץ רק את 6 הפונקציות של הדפים הציבוריים |
| משתמשת מחוברת בלי תפקיד | 0 שורות בכל 18 ה-views. `rpc_rename_student`, `rpc_close_branch` ו-`f_general_allocation`: 42501. `my_branches()` ריקה (נבדק בטרנזקציה שבוטלה) |
| בעלים | כל ה-views מחזירים נתונים (תלמידות, חייבות, גבייה, הוראות קבע, דוחות) |
| Security Advisor | **0 שגיאות** (היו 16). נשארו 4 סוגי אזהרות, כולן בטבלת "מה נשאר פתוח": 6 דפים ציבוריים, RPC שבודקות תפקיד בפנים, הגנת סיסמאות דולפות ו-pg_net |

הערה תפעולית (לא אבטחה): הגיבוי הראשון אחרי המיגרציה נפל על `statement timeout` ב-`rpc_backup_dump`, וניסיון שני הצליח. הגיבוי (13MB) קרוב למגבלת הזמן, וכדאי לפצל אותו לפני שהנתונים יגדלו.
