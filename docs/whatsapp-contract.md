# חוזה whatsapp-hub

**מקור:** [`moti-lang/whatsapp-hub`](https://github.com/moti-lang/whatsapp-hub) @ `76a2617`
**נקרא מהקוד, לא מתיעוד.** אם השרת משתנה — זה הקובץ שמשווים מולו.

הקבצים שמהם נגזר החוזה:

| מה | איפה בשרת |
|---|---|
| הזדהות | `src/api/auth.ts` |
| נקודות קצה | `src/api/routes.ts` |
| מפתח ייחודיות | `src/store/idempotency.ts` |
| רשימת האירועים וחתימה | `src/store/webhooks.ts` |
| מסירת webhook | `src/webhooks/dispatcher.ts` |
| מבנה ההודעה הנכנסת | `src/wa/client.ts` |

---

## 1. הזדהות

כל קריאה ל-API דורשת כותרת **`x-api-key`** עם הערך שב-`.env` של השרת.

```
x-api-key: <WA_API_KEY>
```

ההשוואה בשרת עמידה לתקיפת תזמון: הוא משווה תקצירי SHA-256 ולא מחרוזות,
כך שגם אורך הסוד לא דולף (`safeEqual` ב-`auth.ts`).

> **⚠️ שינוי מהתכנון המקורי.** האפיון דיבר על `X-WA-Secret`. השרת אינו מכיר
> כותרת כזו. הכותרת היא `x-api-key`.

---

## 2. שליחת הודעה

```http
POST {WA_SERVER_URL}/api/send
x-api-key: <WA_API_KEY>
Idempotency-Key: <מפתח>
Content-Type: application/json

{ "phone": "972521234567", "text": "...", "source": "teichtal-crm" }
```

> **⚠️ שינוי מהתכנון.** הפרמטרים הם `phone` ו-`text`, **לא** `to` ו-`body`.
> הנתיב הוא `/api/send`, **לא** `/send`.

### תשובה

| מצב | גוף |
|---|---|
| הצלחה | `{ ok: true, waId: "3EB0...", phone: "972...", guessed: false, note?: "..." }` |
| כשל | `{ ok: false, error: "..." }` |
| `409` | `{ ok: false, error: "בקשה זהה עם אותו מפתח כבר בביצוע" }` |

`waId` הוא מזהה ההודעה של וואטסאפ, ויכול לחזור `null` גם בשליחה מוצלחת.

### `Idempotency-Key`

השרת שומר `(key, endpoint)` בטבלה ב-DB, עם TTL של **24 שעות**. ניסיון חוזר עם
אותו מפתח מחזיר את התשובה המקורית במקום לשלוח שוב. המפתח הוא **פר נקודת קצה** —
אותו מפתח ב-`/send` וב-`/send-media` הן שתי בקשות נפרדות.

**איך אנחנו מייצרים אותו** (`wa-send/index.ts`):
* תזכורת → `reminder-{id}`
* אחרת → `crm-{sha256(phone|text|YYYY-MM-DDTHH:mm)[:12]}`

`409` אינו שגיאה שכדאי לנסות שוב עליה — ההודעה כבר בדרך.

### פורמט הטלפון

השרת מנרמל ל-E.164 **בלי `+`** (`src/lib/phone.ts`), למשל `972521234567` —
זהה לפורמט שבו אנחנו שומרים מספרים.

---

## 3. בריאות

```http
GET {WA_SERVER_URL}/api/health
x-api-key: <WA_API_KEY>
```

```json
{
  "ok": true,
  "healthy": true,
  "whatsapp": { "state": "connected", "phone": "972...", "connectedAt": "...", "lastError": null },
  "uptimeSeconds": 812340,
  "memory": { "rssMb": 210, "heapUsedMb": 90, "heapTotalMb": 130 },
  "disk": { "freeMb": 18000, "totalMb": 40000 },
  "database": { "sizeKb": 4200, "messages": 18431 },
  "queue": { "activeCampaignId": null, "busy": false },
  "rateLimit": { "limit": 20, "remaining": 20 }
}
```

> **⚠️ קריטי.** השרת מחזיר **`503`** כשוואטסאפ אינו מחובר (`healthy: false`).
> זה מבדיל בין שני מצבים שונים לגמרי:
> * **`503`** — התהליך חי, החיבור לוואטסאפ נפל (QR פג, הטלפון נותק, הקישור בוטל).
> * **timeout / connection refused** — השרת עצמו מת.
>
> systemd מטפל בשני, לא בראשון. הראשון הוא הנפילה השקטה.

---

## 4. אירועים נכנסים (webhook)

### רישום

```bash
curl -X POST "$WA_SERVER_URL/api/webhooks" \
  -H "x-api-key: $WA_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"teichtal-crm",
       "url":"https://<project>.supabase.co/functions/v1/wa-webhook",
       "events":["message.received","connection.changed","message.sent","message.failed"]}'
```

הסוד שחוזר בתשובה הוא `WA_WEBHOOK_SECRET`. אפשר לסובב אותו ב-
`POST /api/webhooks/:id/rotate-secret`.

### כותרות המסירה

| כותרת | תוכן |
|---|---|
| `x-hub-event` | שם האירוע |
| `x-hub-delivery` | מזהה המסירה (עולה בניסיונות חוזרים) |
| `x-hub-signature` | `sha256=<hex>` |

### אלגוריתם החתימה

```
signature = "sha256=" + HMAC_SHA256(raw_request_body, webhook_secret).hex()
```

> **⚠️ שינוי מהתכנון.** האימות אינו סוד משותף בכותרת אלא **HMAC על הגוף הגולמי**.
> זה חזק יותר, ויש לו מלכודת אחת: חייבים לחתום על **הבתים כפי שהתקבלו**.
> אימות מול JSON שעבר `JSON.parse` ואז `JSON.stringify` ייכשל — אלה בתים אחרים.
> `npm run test:wa` מאמת את זה מול מימוש זהה ל-`sign()` של השרת, כולל עברית
> ואימוג׳י ב-UTF-8.

### לוח הניסיונות החוזרים

`30 שניות · 2 דקות · 10 דקות · 30 דקות · שעתיים`, ואחרי **20 כשלים רצופים**
ה-webhook מושבת אוטומטית. תשובת `5xx` מצדנו גורמת לניסיון חוזר — וזה רצוי.
תשובת `2xx` סוגרת את המסירה.

### מעטפת ה-payload

```json
{ "event": "message.received", "timestamp": "2026-09-02T10:00:00.000Z", "data": { } }
```

### האירועים

| אירוע | `data` |
|---|---|
| `message.received` | `{ id, phone, display, name, type, text, fileName, mediaPath, mediaUrl, waId, receivedAt }` |
| `message.sent` | `{ id, phone, type, text, source, campaignId }` |
| `message.failed` | `{ id, phone, type, text, error, source, campaignId }` |
| `connection.changed` | `{ state, phone, error }` |
| `campaign.finished` | פרטי הקמפיין |
| `group.message` | הודעת קבוצה; תשובת `{reply}` נשלחת חזרה לקבוצה |

> **⚠️ אין אירוע מסירה ואין אירוע קריאה.**
> זו הסיבה ש-`msg_status` צומצם ל-`queued/sent/failed` (מיגרציה 0006).
> למערכת אין מידע על "נמסר", ולכן אין ערך כזה שאפשר להציג.

`id` הוא מזהה השורה ב-DB של ה-Hub ותמיד קיים. `waId` הוא של וואטסאפ ויכול
להיות `null`. **אנחנו מדדפים לפי `id`** ונופלים ל-`waId` רק אם חסר.

---

## 5. ההנחות שאנחנו מסתמכים עליהן

אם אחת מאלה משתנה בשרת, משהו אצלנו נשבר בשקט:

1. **`data.id` תמיד קיים ב-`message.received`.** בלעדיו אין מניעת כפילויות.
   `parseHubEvent` מחזיר `null` והאירוע לא מעובד — בכוונה.
2. **`x-hub-signature` הוא `sha256=<hex>` על הגוף הגולמי.**
3. **`/api/health` מחזיר `503` כשמנותק** — לא `200` עם דגל.
4. **הטלפון הוא E.164 בלי `+`.**
5. **`Idempotency-Key` נשמר 24 שעות.** מעבר לזה, אותו מפתח = בקשה חדשה.

---

## 6. מה שאנחנו לא משתמשים בו (עדיין)

`/api/send-media` · `/api/check` · `/api/contacts/*` (opt-in / opt-out) ·
`/api/templates` · `/api/campaigns` · `/api/compliance/check-content` ·
`/api/number-health` · `/api/backups`

חלקם רלוונטיים לסבבים הבאים — במיוחד `contacts/opt-out` לתאימות רגולטורית
ו-`number-health` לניטור מוניטין המספר.
