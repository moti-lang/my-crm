// ai-command — פרסור פקודות וואטסאפ. **מחזיר JSON בלבד.**
//
// ⛔ הפונקציה הזו לא מייבאת לקוח מסד ולא יכולה לכתוב לשום מקום —
// לא לטבלת commands, לא ל-audit_log, ולא לוג חלקי. ההקשר (שמות סניפים
// ותלמידות) מגיע בגוף הבקשה מהקורא, ולא נשלף כאן.
//
// זה מבני ולא מוסכם: יש בדיקה (supabase/tests/ai-command-purity.test.mjs)
// שנכשלת אם מישהו יוסיף כאן גישה למסד.
//
// ההחלטה מה לעשות עם התוצאה — אישור, ביצוע, ביטול — היא של 6ב.
import { aiProvider, type CommandContext } from '../_shared/ai.ts';
import { requireUserJwt } from '../_shared/guard.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  // verify_jwt מקבל גם את מפתח ה-anon הציבורי. כאן: משתמשת מחוברת בלבד.
  const denied = requireUserJwt(req);
  if (denied) return denied;

  if (req.method !== 'POST') return json({ error: 'שיטה לא נתמכת' }, 405);

  let input: Partial<CommandContext>;
  try {
    input = (await req.json()) as Partial<CommandContext>;
  } catch {
    return json({ ok: false, reason: 'bad_request', detail: 'גוף הבקשה אינו JSON תקין' }, 400);
  }

  const text = (input.text ?? '').trim();
  if (!text) return json({ ok: false, reason: 'bad_request', detail: 'טקסט ריק' }, 400);

  const ctx: CommandContext = {
    text,
    today: input.today ?? new Date().toISOString().slice(0, 10),
    branches: input.branches ?? [],
    students: input.students ?? [],
    categories: input.categories ?? [],
  };

  const outcome = await aiProvider().parseCommand(ctx);

  // גם כישלון מוחזר כ-200 עם ok:false — זו תשובה תקינה ולא שגיאת שרת.
  // הקורא הוא שמחליט מה לעשות איתה.
  return json(outcome);
});
