// ai-answer — סוכן הלקוחות (סעיף 4.4). **מחזיר JSON בלבד.**
//
// ⛔ כמו ai-command: אין כאן לקוח מסד. ההקשר (מאגר, סניפים, היסטוריה,
// הגדרת המחירים) מגיע בגוף הבקשה. הכתיבות — שאלות ללא מענה, לידים,
// מונה שימוש — הן של _shared/customer.ts, שרץ מתוך wa-webhook.
//
// הקוראת היחידה מהדפדפן היא הסימולטור במסך /agent (verify_jwt=true):
// הוא מריץ את אותו ספק ואותו פרומפט מול המאגר האמיתי, בלי לכתוב דבר.
import { answerProvider, type AnswerContext } from '../_shared/answer.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'שיטה לא נתמכת' }, 405);

  let input: Partial<AnswerContext>;
  try {
    input = (await req.json()) as Partial<AnswerContext>;
  } catch {
    return json({ ok: false, reason: 'bad_request', detail: 'גוף הבקשה אינו JSON תקין' }, 400);
  }

  const text = (input.text ?? '').trim();
  if (!text) return json({ ok: false, reason: 'bad_request', detail: 'טקסט ריק' }, 400);

  const ctx: AnswerContext = {
    text,
    history: Array.isArray(input.history) ? input.history.slice(-10) : [],
    faq: Array.isArray(input.faq) ? input.faq : [],
    branches: Array.isArray(input.branches) ? input.branches : [],
    mayQuotePrices: input.mayQuotePrices === true,
    lead: input.lead ?? null,
  };

  const outcome = await answerProvider().answer(ctx);
  return json(outcome);
});
