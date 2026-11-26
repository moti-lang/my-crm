# חוזה וואטסאפ — GOWA

**מקור:** [`aldinokemal/go-whatsapp-web-multidevice`](https://github.com/aldinokemal/go-whatsapp-web-multidevice) **@ `v9.10.0`**
(commit `c24d02c`). הכל נלקח מהתיעוד ומהקוד של התגית — `docs/openapi.yaml`, `docs/webhook-payload.md`,
`src/ui/rest/app.go`, `src/infrastructure/whatsapp/webhook.go`, `src/pkg/utils/whatsapp.go` — לא מהזיכרון.
התקציר שהבדיקות רצות מולו: `supabase/tests/fixtures/gowa-contract.json` (בדיקה: `wa-contract.test.mjs`).

> **החלטה קבועה (16/11/2026):** כל חיבור וואטסאפ לא רשמי — על GOWA v9. השרת הקודם נמחק (25/11/2026).
> GOWA של טייכטל רצה בקונטיינר נפרד (`wa-teichtal`) מאחורי Caddy עם Basic Auth. Supabase ו-Netlify נשארים בענן.

## קובץ אחד מדבר עם GOWA

`supabase/functions/_shared/wa.ts` — ורק הוא. כל השאר (wa-send, wa-webhook, wa-admin, cron-wa-health,
התשובות לשולחות) משתמש בממשק שלו. בדיקה מוודאת שאף קובץ אחר לא קורא את הסודות או פונה לכתובות של GOWA.

## סודות — רק ב-Edge Functions

| משתנה | מה |
|---|---|
| `WA_BASE_URL` | כתובת GOWA, https בלבד (למשל `https://wa-teichtal.automation1.io`) |
| `WA_DEVICE_ID` | המכשיר ב-GOWA (כותרת `X-Device-Id` בכל קריאה) |
| `WA_USER` · `WA_PASS` | Basic Auth |
| `WA_WEBHOOK_SECRET` | הסוד שבו GOWA חותמת את ה-webhook (`WHATSAPP_WEBHOOK_SECRET` שלה) |
| `WA_TEST_PHONE` | מצב בדיקה: הודעה אמיתית יוצאת **רק** למספר הזה |
| `WA_DRY_RUN` | `true` (ברירת המחדל) — שום הודעה לא יוצאת, חוץ ממספר הבדיקה |

לא בגיט, לא בפרונט, לא בצ'אט. הבעלים מכניס אותם ישירות לסודות של ה-Edge Functions.
**חסר אחד מהארבעה הראשונים → "לא מוגדר"**: המסך מציג את זה, שום דבר לא קורס ושום דבר לא נשלח
(תזכורות נשארות בתור).

## מתי הודעה יוצאת באמת

1. `WA_TEST_PHONE` מוגדר → רק למספר הזה. כל השאר — הרצה יבשה (גם אם `WA_DRY_RUN=false`).
2. אחרת → רק כש-`WA_DRY_RUN=false` במפורש.

## הקריאות

אימות בכל קריאה: `Authorization: Basic …` + `X-Device-Id: <WA_DEVICE_ID>`.

| פעולה | קריאה | גוף | תשובה |
|---|---|---|---|
| טקסט | `POST /send/message` | JSON: `{phone, message}` | `results.message_id` |
| תמונה | `POST /send/image` | multipart: `phone`, `caption`, `image` או `image_url` | `results.message_id` |
| קובץ | `POST /send/file` | multipart: `phone`, `caption`, `file` או `file_url` | `results.message_id` |
| מצב | `GET /app/status` | — | `results.is_connected`, `is_logged_in`, `jid` |
| QR | `GET /app/login` | — | `results.qr_link` (PNG תחת `/statics/…`), `qr_duration` |
| ניתוק | `GET /app/logout` | — | — |

* **טלפון:** במערכת תמיד `972XXXXXXXXX` (נרמול אחד — `_shared/phone.ts`, ובמסד `f_normalize_phone`).
  הסיומת `@s.whatsapp.net` מתווספת רק בתוך `wa.ts`.
* **QR:** `qr_link` נבנה ב-GOWA מהמארח שהבקשה הגיעה אליו. לא סומכים עליו: לוקחים רק את הנתיב
  (`/statics/…`) ומבקשים אותו מ-`WA_BASE_URL` עם האימות. הדפדפן מקבל תמונה בלבד (דרך wa-admin).
* **שגיאות:** 429/502/503/504 — GOWA לא קיבלה, מותר לנסות שוב. 4xx/500 — לא. **אין תשובה (פג זמן)** —
  "לא ברור אם נשלחה", ולא חוזרים: ל-GOWA אין מפתח ייחודיות, וניסיון חוזר עלול לשלוח פעמיים.

## webhook נכנס

כתובת: `https://kzoxlusbocxjinfxckhe.supabase.co/functions/v1/wa-webhook` (verify_jwt = false — GOWA לא שולחת JWT).

* **חתימה:** `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(WA_WEBHOOK_SECRET, הגוף הגולמי)>`.
  נבדקת **לפני כל נגיעה במסד** (`_shared/wa-webhook-core.ts`). חסרה / שגויה / אין סוד → 401, בלי מסד.
  ההוכחה: `wa-webhook.test.mjs` (מסד מזויף שסופר כל קריאה), ובקרת שלילה.
* **מעטפת:** `{event, device_id, session_id, payload}`. הודעה: `event = "message"`, ב-`payload`:
  `id`, `chat_id`, `from`, `from_name`, `sender_display_name`, `timestamp`, `is_from_me`, `body`.
* מתעלמים: הודעות שלי, קבוצות / סטטוסים / ערוצים, ושאר האירועים. בלי `id` או בלי מספר (LID בלבד) — לא מעובדת, והבעלים מקבלת התראה.
* `device.logged_out` / `device.temporary_ban` / `device.reachout_timelock` → הבריאות "down" והתראה קריטית; התור נעצר.
* GOWA מנסה שוב כשאין 2xx. מניעת הכפילויות: מפתח ייחודי על `wa_messages.provider_msg_id`.

## קצב שליחה

הודעות רבות באותו נוסח ברצף — מה שוואטסאפ חוסם עליו. ההגדרות ב-`settings.wa_pacing` (עריכה במסך הגדרות ← וואטסאפ):
`min_gap_seconds` / `max_gap_seconds` (מרווח אקראי בין הודעות בתור, ברירת מחדל 8–20), `max_per_minute` (4),
`run_budget_seconds` (זמן סבב של התור, 110). התור (`cron-reminders` → `_shared/send-queue.ts`) ממתין מרווח אקראי;
המסד אוכף מרווח מינימלי ותקרה לדקה לכל שליחה אמיתית (`rpc_wa_reserve_send`), גם מול שליחות במקביל.
שליחה להרבה נמענים תמיד עוברת בתור התזכורות. כשמפעילים את התור: `cron-reminders` כל 2–5 דקות.

## בדיקה חיה

`node scripts/verify-whatsapp.mjs` — בריאות דרך המערכת. `--send` — הודעת בדיקה אחת למספר הבדיקה, דרך wa-send.
