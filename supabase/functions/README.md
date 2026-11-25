# Edge Functions

וואטסאפ: **GOWA** (go-whatsapp-web-multidevice v9) — קונטיינר נפרד מאחורי Basic Auth. החוזה המלא,
הסודות, מצב הבדיקה וקצב השליחה: [docs/whatsapp-contract.md](../../docs/whatsapp-contract.md).
רק `_shared/wa.ts` מדבר עם GOWA.

## השומר — חובה בכל פונקציה

המשפט הראשון ב-handler של כל פונקציה הוא שומר מ-`_shared/guard.ts`: `requireCronSecret(req)` (cron-* ו-`wa-send`), `requireUserJwt(req)` (`ai-answer`, `ai-command`, `wa-admin`), או `handleWaWebhook` (`wa-webhook` — חתימת HMAC של GOWA לפני כל גישה למסד). `function-guards.test.mjs` בודק את זה, ו-`scripts/functions-deploy-api.mjs` מסרב לפרוס פונקציה בלעדיו. ראה [SECURITY.md](../../SECURITY.md).

## וואטסאפ בקצרה

| פונקציה | מה |
|---|---|
| `wa-send` | שער היציאה היחיד: בריאות, שעות שקטות, קצב (`rpc_wa_reserve_send`), ניסיונות, רישום |
| `cron-reminders` | התור — מרווח אקראי בין הודעות (`_shared/send-queue.ts`), זמן סבב מוגבל |
| `wa-webhook` | הודעות נכנסות מ-GOWA — `X-Hub-Signature-256` נבדקת קודם (`_shared/wa-webhook-core.ts`) |
| `wa-admin` | מסך ההגדרות (בעלים): מצב, QR (תמונה בלבד), ניתוק |
| `cron-wa-health` | בדיקת בריאות; "לא מוגדר" אינו תקלה |

## דגלי הרצה יבשה

| דגל | ברירת מחדל | מה קורה |
|---|---|---|
| `WA_DRY_RUN` | `true` | כל הלוגיקה רצה — בריאות, שעות שקטות, ניסיונות, רישום — ושום הודעה לא יוצאת (חוץ מ-`WA_TEST_PHONE`, אם הוגדר) |
| `AI_DRY_RUN` | `true` | פלטים מוקלטים ותקפים מבחינת סכימה — גם לפקודות וגם לסוכן הלקוחות. Claude לא נקרא |

**ברירת המחדל יבשה.** מעבר לחי מחייב `false` מפורש — ובוואטסאפ, רק אחרי אישור מפורש של הבעלים.

## משתני סביבה

סודות הוואטסאפ (`WA_BASE_URL`, `WA_DEVICE_ID`, `WA_USER`, `WA_PASS`, `WA_WEBHOOK_SECRET`, `WA_TEST_PHONE`)
— הבעלים מכניס אותם ישירות לסודות של ה-Edge Functions. לא בגיט, לא בפרונט, לא בצ'אט.

```bash
supabase secrets set OWNER_ALERT_WEBHOOK=...     # ערוץ חלופי, ראה למטה
supabase secrets set RESEND_API_KEY=... BACKUP_MAIL_TO=... BACKUP_MAIL_FROM=...   # הגיבוי היומי במייל
```

## SUMIT — `sumit-checkout`, `sumit-webhook`, `cron-sumit-sync`

משתני סביבה: `SUMIT_DRY_RUN` (ברירת מחדל true), `SUMIT_COMPANY_ID`, `SUMIT_API_KEY`,
`SUMIT_WEBHOOK_SECRET` (מונפק ב-`npm run sumit:schedule`), `APP_BASE_URL`.
האדפטר `_shared/sumit.ts`; הקליטה `_shared/sumit-sync.ts` (מוזרק db+ספק, נבדק
ב-`sumit.test.mjs`). ראה README הראשי, "גבייה בכרטיס".

## מניעת כפילויות — בשני הכיוונים

GOWA שולחת שוב כשלא מקבלת 2xx. כפילות בפקודה כספית = הוצאה שנרשמת פעמיים.

* **כניסה:** `wa_messages.provider_msg_id` עם אינדקס ייחודי. מסירה חוזרת נופלת על
  שגיאה `23505` וה-webhook מסיים בשקט. האכיפה במסד ולא בקוד — קוד מפספס מרוצי תהליכים.
* **יציאה:** ל-GOWA אין מפתח ייחודיות. לכן ניסיון חוזר רק כש-GOWA לא קיבלה את הבקשה
  (429 / שער), ושליחה שלא חזרה עליה תשובה מסומנת "לא ברור אם נשלחה" ולא נשלחת שוב.
  תזכורת נשלחת פעם אחת — הסטטוס שלה במסד הוא המפתח.

## ניטור החיבור

שני מנגנונים, כי אף אחד מהם לבדו אינו מספיק:

1. **`connection.changed`** — מיידי, אבל מגיע רק כשהשרת חי ומספיק בריא כדי לשלוח.
2. **`cron-wa-health` כל 10 דקות** — תופס את המקרה שבו השרת עצמו מת ואף webhook לא יגיע.
   **שקט אינו סימן לבריאות.**

כשהחיבור נפול: `wa-send` מחזיר 503, התזכורת נשארת `scheduled` ו**לעולם לא מסומנת
`sent`**. הודעה שלא יצאה לא תיספר כאילו יצאה.

## הערוץ החלופי

כשהוואטסאפ נפול אי אפשר להתריע בוואטסאפ. כל התראה נכתבת ל-`system_alerts` —
מזין את הבאנר בדשבורד ואת מסך ההגדרות — ובנוסף נשלחת ל-`OWNER_ALERT_WEBHOOK`
אם הוגדר (Telegram, Slack, Pushover, כל דבר שמקבל POST).

בלי `OWNER_ALERT_WEBHOOK` ההתראה קיימת רק בתוך המערכת, כלומר מישהי צריכה להיכנס
כדי לראות אותה. זו הנחה שנשענת על כך שמישהי נכנסת.

## סוכן הפקודות (סבב 6א)

הנתב ב-`_shared/router.ts`, מוצא מ-`wa-webhook` בכוונה: כך אפשר להריץ
אותו מול מסד מזויף שמתעד כל כתיבה, ולהוכיח את הטענה המרכזית במקום
להסתמך על קריאת הקוד.

**`ai-command` אינה יכולה לכתוב למסד.** אין לה לקוח מסד, ההקשר מגיע
בגוף הבקשה, ויש בדיקה מבנית (`npm run test:purity`) שנכשלת אם מישהו
יוסיף אחד. פרסור שנכשל, JSON פגום או ביטחון מתחת ל-0.6 — אפס כתיבות,
כולל לוגים חלקיים.

**הסכימה נאכפת ב-API** דרך `output_config.format`, לא רק מתבקשת
בפרומפט. `AI_DRY_RUN=true` (ברירת המחדל) מחזיר פלטים מוקלטים
מ-`_shared/ai-fixtures.ts`, כך שכל חבילת הבדיקות של הנתב רצה **בלי
מפתח Anthropic ובלי לשלם על אף קריאה**. הפלטים כוללים את המקרים
הפגומים — הם החשובים ביותר.

המודל נקבע ב-`ANTHROPIC_MODEL` (ברירת מחדל `claude-haiku-4-5` לפי
האפיון). ה-SDK נטען דינמית, כך שמסלול ההרצה היבשה לא טוען אותו כלל.

מה **לא** נבנה עדיין, ובכוונה: אישור, ביצוע, ו-rollback. אלה 6ב,
ואין להתחיל בהם לפני שכל תנאי הקבלה של 6א עוברים.

## מבנה

- `_shared/wa.ts` — `WhatsAppProvider` (`sendText` · `checkHealth` · `parseIncoming`),
  `DryRunProvider` / `SelfHostedProvider`, ואימות חתימה
- `_shared/health.ts` — קריאה וכתיבה של `wa_health`, ושער `maySend`
- `_shared/alerts.ts` — הערוץ החלופי
- `_shared/quiet-hours.ts` — שעות שקטות, שבת וחגים לפי שעון ישראל
- `wa-send/` — שער היציאה היחיד
- `wa-webhook/` — שער הכניסה היחיד
- `cron-wa-health/` — בדיקה כל 10 דקות


## סוכן הלקוחות — `ai-answer` ו-`_shared/customer.ts`

`_shared/answer-resolve.ts` — סדר העדיפות (מאגר גובר → מידע על החוג מעוגן → הפניה)
והשומרים (מחיר, הבטחות), בלי מסד. רץ גם בוואטסאפ וגם בסימולטור, כדי שהסימולטור
יראה בדיוק מה היה נשלח ומאיפה.

אותו דפוס כמו הפקודות: `ai-answer` היא פונקציה טהורה (אין לה לקוח מסד,
ההקשר מגיע בגוף הבקשה) ומשמשת רק את הסימולטור במסך `/agent`. המסלול
האמיתי רץ בתוך `wa-webhook`: מספר שאינו מורשה מנותב ל-`answerCustomer`
ב-`_shared/customer.ts`, שקורא לאותו ספק (`_shared/answer.ts`) וכותב
את מה שצריך — שאלות ללא מענה, לידים, מונה שימוש — ומחזיר החלטה
ש-`deliverReply` שולח.

מה שנאכף בקוד ולא בפרומפט: "אין תשובה" מקבל תמיד את המשפט הקבוע,
תשובה שנוקבת מחיר מוחלפת בהפניה כל עוד `agent_may_quote_prices=false`,
תלמידה נוצרת רק כשכל חמשת הפרטים ידועים והסניף קיים, ופלט פגום של
המודל לא מגיע להורה. `supabase/tests/customer-agent.test.mjs`.

## פריסה בלי CLI

`node scripts/functions-deploy-api.mjs [slug…]` פורס דרך ה-Management API
(עם `SUPABASE_ACCESS_TOKEN`), כולל כל `_shared/` ו-`verify_jwt` מ-config.toml.
`deploy.sh` בוחר בו אוטומטית כשאין `supabase` בנתיב. אומת: `ai-answer`
נפרסה כך, עונה בהרצה יבשה, ומחזירה 401 בלי JWT.

## `cron-backup` — הגיבוי היומי

Storage + מייל, ראה README ("גיבוי אוטומטי במייל"). המייל דרך Resend
(`_shared/mail.ts`); בלי מפתח המייל מוחזר ככשל ומתריע, לא נבלע.
