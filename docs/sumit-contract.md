# החוזה מול SUMIT — מה אומת, מה הונח

מתועד כמו `whatsapp-hub`: נקודות קצה, שדות, פורמטים, ומה אנחנו מניחים. כל שורה
מסומנת **אומת** (תשובה אמיתית מארגון הבדיקה, ראיה ב-`docs/sumit-contract.raw.json`)
או **הנחה** (מהספריות הפתוחות `sumit-api`/`sumit-react` ומתיעוד שנקרא בתוצאות
חיפוש; הדומיינים של SUMIT חסומים בסנדבוקס). הגילוי רץ ב-`scripts/sumit-discover.mjs`
דרך ה-Edge Function הזמנית `sumit-probe` (CRON_SECRET).

## ארגון הבדיקה

| | |
|---|---|
| CompanyID | 2410781753 (ארגון בדיקות, מסוף בדיקות, כרטיסי דמה בלבד) |
| מפתח | `SUMIT_API_KEY` — סוד של הפונקציות, לא בריפו |
| בסיס | `https://api.sumit.co.il` · POST · JSON · `Credentials: { CompanyID, APIKey }` בגוף |

## 1. יצירת דף תשלום — `/billing/payments/beginredirect/`

**נקודת הקצה אומתה על ידי החברה** (ודורשת מודול "דפי תשלום"). השדות — **הנחה**
עד שהגילוי ירוץ:

```json
{
  "Credentials": { "CompanyID": 0, "APIKey": "…" },
  "Customer": { "Name": "", "Phone": "", "EmailAddress": "", "ExternalIdentifier": "tl-<uuid>", "SearchMode": 0 },
  "Items": [{ "Item": { "Name": "שכר לימוד — <שם> (<סניף>)" }, "Quantity": 1, "UnitPrice": 210, "TotalPrice": 210, "Currency": "ILS" }],
  "ExternalIdentifier": "tl-<uuid>",
  "RedirectURL": "https://teichtal-crm.netlify.app/pay/<token>?returned=1",
  "IPNURL": "https://<ref>.supabase.co/functions/v1/sumit-webhook",
  "VATIncluded": true, "Language": 0, "MaximumPayments": 1
}
```

תשובה (הנחה): `{ "Status": 0, "Data": { "RedirectURL": "https://pay.sumit.co.il/…" } }`.
מה שנקרא מהתשובה ב-`_shared/sumit.ts`: `Data.RedirectURL ?? Data.URL ?? Data.PaymentPageURL`.

## 2. ה-IPN (הטריגר אחרי תשלום) — `sumit-webhook`

**הנחה**: SUMIT שולחת POST ל-`IPNURL` (או לטריגר שהוגדר בממשק) באחד משלושה
פורמטים: JSON, `application/x-www-form-urlencoded`, או מעטפת `json=<מחרוזת>`.
אין חתימה. אנחנו: סוד משותף בכותרת `x-webhook-secret`, ומהגוף נלקח רק
`ExternalIdentifier` (`extractExternalIdentifier`). **הגוף הוא רמז**; האמת נשאלת
מ-SUMIT (סעיף 3). לכן גם פורמט לא צפוי לא מסכן: במקרה הגרוע ה-cron השעתי קולט.

## 3. שליפת עסקה לפי ExternalIdentifier / PaymentID

**לא ידוע.** המועמדים שהגילוי בודק: `/billing/payments/list/`, `/billing/payments/get/`,
`/billing/payments/getbyexternalidentifier/`, `/billing/payments/search/`, וגם
`/accounting/customers/getbyexternalidentifier/` (הלקוח נושא את המזהה שלנו, ומהלקוח
אולי לתשלומים). הקוד הנוכחי (`getPaymentStatus`) מניח `list` עם סינון בצד שלנו
לפי `ExternalIdentifier`, ושדות `ValidPayment`/`Status`, `Amount`, `ID`, `DocumentID`, `Date`.

## 4. חיוב ישיר (לבדיקות, במקום ההורה בדף) — `/billing/payments/charge/`

**הנחה** (מ-`sumit-api`): אותו גוף כמו דף תשלום + `PaymentMethod` עם פרטי כרטיס
דמה, או `SingleUseToken` מ-`payments.js`. תשובה: `Payment.ValidPayment`, `Payment.Status`
("000"), `CustomerID`, `DocumentID`. משמש רק מול מסוף הבדיקות.

## 5. מה שאנחנו מניחים בכל מקרה (ולא תלוי ב-SUMIT)

- `ExternalIdentifier` שלנו (`tl-<uuid>`) על כל דף/תשלום. רישום אידמפוטנטי לפי
  הקישור ולפי מזהה התשלום של SUMIT (`rpc_record_sumit_payment`).
- תפוגה 7 ימים אצלנו; דף SUMIT נוצר רק בלחיצה, עם הסכום מהרשומה.
- "שולם" אצלנו רק אחרי תשובת SUMIT, לעולם לא מהדפדפן ולא מגוף ה-IPN.

## מה אומת בסבב הגילוי הראשון (2026-10-05)

**המעטפה** (אומת, בכל נקודת קצה): `{ "Data": …|null, "Status": 0|1|2, "UserErrorMessage": …, "TechnicalErrorDetails": … }`
עם HTTP 200 גם בשגיאה. `Status: 1` = פרטי גישה שגויים; `Status: 2` = הגוף לא תואם
לסכמה, ו-`TechnicalErrorDetails` אומר איזה שדה (למשל `PaymentID: Error converting value {null}`).

**נקודות קצה קיימות** (אומת: עונות במעטפה, לא בהפניה אינסופית):
`/billing/payments/beginredirect/`, `/billing/payments/list/`, `/billing/payments/get/`
(דורשת `PaymentID` מספרי, לא null), `/billing/payments/charge/`, `/website/companies/getdetails/`.
**לא קיימות** (אומת: שרשרת הפניות עד 20): `/billing/payments/getbyexternalidentifier/`,
`/billing/payments/search/`, `/accounting/customers/getbyexternalidentifier/`,
`/accounting/customers/list/`. **מארח**: רק `api.sumit.co.il` חי; `api.dev`/`dev`/`api-dev` לא.

**חסום**: כל הקריאות מחזירות `Invalid Credentials (CompanyID/APIKey are incorrect)` עם
הזוג 2410781753 / המפתח שנמסר, בכל ניסוח (מספר/מחרוזת, עם/בלי רווח). שדות
beginredirect והשליפה לפי ExternalIdentifier נשארים **הנחה** עד שיתקבל זוג תקף.

## סטטוס הגילוי

רץ, ונעצר בפרטי הגישה. להמשך: זוג CompanyID/APIKey תקף של ארגון הבדיקה
(ב-SUMIT: הגדרות ← API ← "מפתח API", לא "מפתח ציבורי"; מודול API מותקן בארגון
הבדיקה עצמו; ה-CompanyID של אותו ארגון). ואז: `node scripts/sumit-discover.mjs`
← לעדכן כאן מ-"הנחה" ל-"אומת" ← לחבר ב-`_shared/sumit.ts`.
