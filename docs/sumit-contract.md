# החוזה מול SUMIT — מה אומת, מה הונח

מתועד כמו `whatsapp-hub`. **אומת** = תשובה אמיתית מארגון הבדיקה "חוגי טייכטל -
בדיקות" (CompanyID 2410781753, מסוף בדיקות), ראיות ב-`docs/sumit-contract.raw.json`
ובסבב 2026-10-05. **הנחה** = טרם נצפה. הגילוי רץ ב-`scripts/sumit-discover.mjs`
דרך `supabase/functions/sumit-probe` (CRON_SECRET; נשמר בריפו, **לא פרוס** —
`node scripts/functions-deploy-api.mjs sumit-probe` כשצריך סבב נוסף).

## בסיס (אומת)

| | |
|---|---|
| מארח | `https://api.sumit.co.il` בלבד (`api.dev`/`dev`/`api-dev` לא קיימים) |
| פרוטוקול | POST · JSON · `Credentials: { CompanyID: <מספר>, APIKey: <מחרוזת> }` בגוף כל קריאה |
| מעטפה | תמיד HTTP 200: `{ Data, Status, UserErrorMessage, TechnicalErrorDetails }` · `Status 0` הצלחה · `1` שגיאה עסקית (טקסט ב-`UserErrorMessage`, לעיתים בעברית) · `2` גוף לא תואם (`TechnicalErrorDetails` נוקב בשדה) |
| נתיב שלא קיים | הפניה 302 (לא 404). האדפטר שולח `redirect: 'manual'` ומתרגם לשגיאה |
| מפתח | "מפתח API" מהגדרות ← API של **אותו ארגון**. מפתח שלא התקבל אף פעם מראה "שימוש אחרון: ריק" |
| פרטי ארגון | `beginredirect` ו-`charge` מסרבים עד שלארגון יש ח.פ. וטלפון ("Missing organization details"). ניתן לקבוע ב-`/website/companies/update/` `{ Company: { Name, CorporateNumber, Phone, … } }` (ח.פ. "000000000" נחשב ריק) |

## 1. דף תשלום — `/billing/payments/beginredirect/` (אומת)

חובה: `Customer`, `Items`. הגוף שעובד:

```json
{
  "Customer": { "Name": "…", "Phone": "05…", "EmailAddress": "…", "ExternalIdentifier": "tl-<uuid>", "SearchMode": 0 },
  "Items": [{ "Item": { "Name": "שכר לימוד — <שם> (<סניף>)" }, "Quantity": 1, "UnitPrice": 210, "TotalPrice": 210, "Currency": "ILS" }],
  "ExternalIdentifier": "tl-<uuid>",
  "RedirectURL": "https://teichtal-crm.netlify.app/pay/<token>?returned=1",
  "IPNURL": "https://<ref>.supabase.co/functions/v1/sumit-webhook",
  "Language": 0, "VATIncluded": true, "MaximumPayments": 1
}
```

תשובה: `{ "Data": { "RedirectURL": "https://pay.sumit.co.il/<org>/a/redirectpayment/?redirectid=<uuid>" } }`.
ה-`redirectid` נשמר על הקישור (`payment_links.sumit_redirect_id`). הדף עצמו מוגן
ב-reCAPTCHA — אי אפשר להשלים אותו ממכונה, ולכן זרימת הדף המלאה (כולל ה-IPN) **טרם
נצפתה מקצה לקצה**; מה שאומת הוא יצירת הדף.

## 2. חיוב ישיר — `/billing/payments/charge/` (אומת; לבדיקות)

אותו גוף + `PaymentMethod: { Type: 1, CreditCard_Number, CreditCard_ExpirationMonth, CreditCard_ExpirationYear (4 ספרות), CreditCard_CVV, CreditCard_CitizenID }`.
תשובה: `Data.Payment { ID, CustomerID, Date, ValidPayment, Status, StatusDescription, Amount, PaymentMethod{…Token, CardMask}, ExternalIdentifier (null!), DocumentID (0 בתשובה המיידית) }`, `Data.CustomerID`.
קודים שנצפו: `000` מאושר · `004` החברה לא אישרה · `015` פג תוקף · `OG_25` מספר כרטיס שגוי · `OG_20` (כפילות/תדירות).

**מסוף הבדיקות**: מאשר רק סכומים **עד 10 ₪** (1, 5, 10 אושרו; 11 ומעלה נדחה 004).
כרטיסי דמה שאושרו: `5555555555554444`, `371449635398431`, `6011111111111117` (תוקף 12/2030, CVV 123, ת.ז. 000000018).
`4580…` ו-`4111…` נדחים (004). לכן תשלום 210 ₪ לא ניתן לאישור במסוף הזה; הזרימה
המלאה נבדקה עם תוכנית זמנית של 10 ₪ (והוחזרה ל-210).

## 3. ★ איתור תשלום של קישור (אומת — וזו התגלית העיקרית)

- **SUMIT לא שומרת את `ExternalIdentifier` שלנו על התשלום** (null ב-`charge`, ב-`list` וב-`get`, בכל מיקום של השדה בגוף). שורת תשלום גם **לא נושאת שם לקוחה**.
- `/billing/payments/list/` דורשת `Date_From`, `Date_To` (YYYY-MM-DD); מחזירה `Data.Payments[]` (אותם שדות כמו Payment למעלה, בלי Items) ו-`HasNextPage`. סינון לפי `CustomerID`/`ExternalIdentifier` בגוף **מתעלם**.
- `/billing/payments/get/` דורשת `PaymentID` מספרי (null → Status 2). מחזירה `Data.Payment`; כאן `DocumentID` כבר מעודכן (הקבלה נוצרת כמה שניות אחרי התשלום).
- **הקבלה היא המפתח**: `/accounting/documents/getdetails/` `{ DocumentID }` → `Data.Document.Customer { ID, Name, Phone, ExternalIdentifier }` — **כן** נושא את המזהה שלנו — ו-`Data.DocumentDownloadURL` (ברמת Data, לא בתוך Document), `Data.Items[]`.
- `/accounting/documents/list/` `{ Date_From, Date_To }` → `Data.Documents[] { DocumentID, DocumentNumber, CustomerID, CustomerName, DocumentDownloadURL, DocumentValue }`.
- לא קיימים: `payments/getbyexternalidentifier`, `payments/search`, כל `*/customers/*` (get/list/create/search/getdetails), `documents/get`, `payments/getredirect*`.

לכן `getPaymentStatus` (ב-`_shared/sumit.ts`): `list` בחלון של הקישור → תשלומים תקפים
אחרי יצירתו → לכל אחד (עד 25, הסכום התואם קודם) `get` אם חסר DocumentID → `documents/getdetails`
→ `Customer.ExternalIdentifier === external_identifier` ⇒ התאמה `external_identifier`.
גיבוי: `payment_id` מה-IPN; ואחרון, `heuristic` (שם + סכום + אחרי הקישור, מועמד יחיד) שמסומן
בהתראה ובמסך ההתאמה. בדיקות: `sumit.test.mjs` (`enrichWithDocuments`, `matchPayment`).

**נבדק מקצה לקצה (2026-10-05)**: הרשמה ב-`/enroll` (הפונקציה החיה) → תלמידה ממתינה +
קישור → `sumit-checkout` יצר דף אמיתי (redirectid נשמר) → תשלום 10 ₪ בכרטיס דמה דרך
`charge` עם `Customer.ExternalIdentifier` של הקישור → `cron-sumit-sync`: `list` → `get` →
`documents/getdetails` → התאמה לפי המזהה → `rpc_record_sumit_payment` → התלמידה **פעילה**,
הקישור `paid`, התשלום ב-`payments` (source `sumit`, קבלה 2411653147), בלי התראות.
נתוני הבדיקה נמחקו אחר כך.

## 4. ה-IPN — `sumit-webhook` (הנחה, עם רשת ביטחון)

הפורמט של ה-POST ל-`IPNURL` **לא נצפה** (דורש השלמת הדף בדפדפן). ההתנהגות שלנו לא תלויה
בו: הגוף נרשם גולמי ב-`sumit_ipn_log` (הבעלים רואה), מחולצים מועמדים (`ExternalIdentifier`,
`redirectid`, `/pay/<token>`, `PaymentID`) — `rpc_sumit_ipn_received` מאתר קישור לפיהם —
ואז אותו `syncPaymentLink` ששואל את SUMIT. בלי IPN בכלל, ה-cron השעתי קולט. הפעם הראשונה
שתגיע IPN אמיתית תתעד את הפורמט בטבלה; אז מעדכנים כאן ל"אומת".
הגדרה ב-SUMIT: טריגר על תיקיית התשלומים → HTTP POST ל-`…/functions/v1/sumit-webhook`
עם כותרת `x-webhook-secret` (`npm run sumit:schedule` מנפיק).

## 5. מה שאנחנו מניחים בכל מקרה

- `ExternalIdentifier` שלנו (`tl-<uuid>`) על הלקוחה ועל הדף; רישום אידמפוטנטי לפי הקישור ולפי
  מזהה התשלום של SUMIT.
- תפוגה 7 ימים אצלנו; דף SUMIT נוצר רק בלחיצה, עם הסכום מהרשומה.
- "שולם" אצלנו רק אחרי תשובת SUMIT, לעולם לא מהדפדפן ולא מגוף ה-IPN.

## 6. שער ההשקה — `SUMIT_CHECKOUT_ALLOW_TOKEN`

סוד פונקציות אופציונלי. כשהוא מוגדר, `sumit-checkout` פותחת דף SUMIT אמיתי רק
לקישור שהטוקן שלו שווה לסוד; כל הורה אחרת מקבלת 503 עם "התשלום המקוון ייפתח
בקרוב". כך עוברים ל-`SUMIT_DRY_RUN=false` מול הארגון האמיתי ומבצעים תשלום
בדיקה קטן בלי לחשוף את הדף לכולן. אחרי שהבדיקה עברה מוחקים את הסוד
(`DELETE /v1/projects/<ref>/secrets` עם `["SUMIT_CHECKOUT_ALLOW_TOKEN"]`)
ופורסים מחדש את `sumit-checkout`. בדיקות: `sumit.test.mjs` + שתי בקרות שלילה.

## פתוח

1. הזרימה דרך **הדף** (לא `charge`): רק בדפדפן אמיתי עם כרטיס דמה ≤10 ₪. אז נראה גם את
   ה-IPN ואת הפרמטרים שעל ה-RedirectURL בחזרה.
2. הוראת קבע (שלב ב'): `/billing/recurring/charge/` — הנחה מהספריות, טרם נבדק.
3. לייצור: מפתח וארגון אמיתיים של הלקוחה (`SUMIT_COMPANY_ID`, `SUMIT_API_KEY`), ח.פ. וטלפון
   מוגדרים בארגון, מודולים: API, סליקה, הכנסות, דפי תשלום, טריגרים.
