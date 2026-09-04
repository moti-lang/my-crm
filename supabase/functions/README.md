# Edge Functions

המערכת מדברת עם **whatsapp-hub** — שרת הוואטסאפ העצמאי
([moti-lang/whatsapp-hub](https://github.com/moti-lang/whatsapp-hub)), לא עם ספק מנוהל.

## החוזה מול השרת

נלקח מהקוד של השרת עצמו, לא מהנחות.

| פעולה | נקודת קצה | גוף | הזדהות |
|---|---|---|---|
| שליחה | `POST {WA_SERVER_URL}/api/send` | `{phone, text, source}` | `x-api-key` + `Idempotency-Key` |
| בריאות | `GET {WA_SERVER_URL}/api/health` | — | `x-api-key` |
| כניסה | השרת דוחף ל-`wa-webhook` | `{event, timestamp, data}` | `x-hub-signature` (HMAC-SHA256) |

שלוש נקודות שקל לפספס:

* **הפרמטרים הם `phone` ו-`text`**, לא `to` ו-`body`.
* **`/api/health` מחזיר 503** כשוואטסאפ מנותק — התהליך חי, החיבור לא. שני מצבים שונים.
* **הכניסה מאומתת בחתימת HMAC**, לא בסוד משותף בכותרת. החתימה היא על **הגוף הגולמי**;
  אימות מול JSON שעבר פרסור וסריאליזציה מחדש ייכשל. `npm run test:wa` מוודא את זה.

### אירועים שהשרת שולח

`message.received` · `message.sent` · `message.failed` · `connection.changed` ·
`campaign.finished` · `group.message`

**אין אירוע מסירה או קריאה.** לכן `msg_status` צומצם ל-`queued/sent/failed`
(מיגרציה 0006) ואין במערכת מצב "נמסר" שאפשר להציג.

## דגלי הרצה יבשה

| דגל | ברירת מחדל | מה קורה |
|---|---|---|
| `WA_DRY_RUN` | `true` | כל הלוגיקה רצה — בריאות, שעות שקטות, ניסיונות, רישום — והשרת לא נקרא |
| `AI_DRY_RUN` | `true` | פלטים מוקלטים ותקפים מבחינת סכימה — גם לפקודות וגם לסוכן הלקוחות. Claude לא נקרא |

**ברירת המחדל יבשה.** מעבר לחי מחייב `false` מפורש.

## משתני סביבה

```bash
supabase secrets set WA_SERVER_URL=https://hub.example.com
supabase secrets set WA_API_KEY=...              # x-api-key של ה-Hub
supabase secrets set WA_WEBHOOK_SECRET=...       # מ-POST /api/webhooks בשרת
supabase secrets set WA_DRY_RUN=false
supabase secrets set OWNER_ALERT_WEBHOOK=...     # ערוץ חלופי, ראה למטה
supabase secrets set RESEND_API_KEY=... BACKUP_MAIL_TO=... BACKUP_MAIL_FROM=...   # הגיבוי היומי במייל
```

רישום ה-webhook בשרת:

```bash
curl -X POST "$WA_SERVER_URL/api/webhooks" -H "x-api-key: $WA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"teichtal-crm","url":"https://<project>.supabase.co/functions/v1/wa-webhook",
       "events":["message.received","connection.changed","message.sent","message.failed"]}'
```

הסוד שחוזר בתשובה הוא `WA_WEBHOOK_SECRET`.

## מניעת כפילויות — בשני הכיוונים

שרת עצמאי שולח שוב אחרי ריסטארט. כפילות בפקודה כספית = הוצאה שנרשמת פעמיים.

* **כניסה:** `wa_messages.provider_msg_id` עם אינדקס ייחודי. מסירה חוזרת נופלת על
  שגיאה `23505` וה-webhook מסיים בשקט. האכיפה במסד ולא בקוד — קוד מפספס מרוצי תהליכים.
* **יציאה:** כותרת `Idempotency-Key` שה-Hub מכיר. לתזכורת המפתח הוא `reminder-{id}`,
  אחרת טביעת אצבע של היעד, הטקסט והדקה. ניסיון חוזר מחזיר את התשובה המקורית
  במקום לשלוח שוב.

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
