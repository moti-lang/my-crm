// wa-webhook — נקודת הכניסה היחידה לאירועים מ-GOWA (verify_jwt = false: GOWA לא שולחת JWT).
// הלוגיקה והסדר (חתימה קודם, מסד אחר כך) — ב-_shared/wa-webhook-core.ts.
// ★ לקוח המסד נוצר רק דרך הפונקציה שמועברת כאן — ו-handleWaWebhook קוראת לה רק אחרי האימות.
import { adminClient } from '../_shared/supabase.ts';
import { whatsappProvider } from '../_shared/wa.ts';
import { handleWaWebhook } from '../_shared/wa-webhook-core.ts';

Deno.serve((req) => handleWaWebhook(req, { db: adminClient, provider: whatsappProvider }));
