import { routeIncoming, type Db, type RouterDeps } from './router.ts';
import { replyOf } from './reply.ts';
import { normalizePhone } from './phone.ts';

/**
 * צ'אט הבדיקה במסך "פקודות וואטסאפ" — הודעה אחת, דרך המנוע האמיתי.
 *
 * ★ זה routeIncoming עצמו, אותה פונקציה ש-wa-webhook מריץ על כל הודעה: אותו פרסור
 *   (ai-command), אותן הרשאות לפי המספר שנבחר, פקודה ממתינה במסד, ו"כן" שמבצע את
 *   rpc_execute_command האטומי. מה שמאושר כאן נרשם במערכת באמת (ואפשר לבטל ביומן).
 * ההבדלים היחידים מוואטסאפ: התשובה חוזרת למסך ולא נשלחת לאף אחד, והפקודה מסומנת
 * ביומן כ"צ'אט בדיקה".
 *
 * חי כאן (ולא בתוך wa-command-test) כדי שבדיקת הדפדפן תריץ בדיוק את הקוד הזה.
 */
export type TestChatResult =
  | { ok: true; route: string; reply: string | null; commandId: string | null;
      parse: Record<string, unknown> | null; authorized: { allowed: boolean; reason?: string } | null;
      result: Record<string, unknown> | null }
  | { ok: false; error: string };

export async function runTestMessage(db: Db & { rpc: unknown }, deps: RouterDeps, input: { phone?: string; text?: string }): Promise<TestChatResult> {
  const phone = normalizePhone(String(input.phone ?? ''));
  const text = String(input.text ?? '').trim();
  if (!text) return { ok: false, error: 'הודעה ריקה' };
  if (text.length > 1000) return { ok: false, error: 'הודעה ארוכה מדי' };
  // רק בשם מספר מורשה פעיל — בדיוק מה שהנתב יזהה. מספר אחר היה הולך למסלול הלקוחות.
  const { data: num } = await db.from('authorized_numbers').select('phone').eq('phone', phone).eq('is_active', true).maybeSingle();
  if (!num) return { ok: false, error: 'בחרי מספר מורשה פעיל' };

  const d = await routeIncoming(db, deps, { phone, body: text, channel: 'test' }) as Record<string, any>;
  const p = d.parse as Record<string, any> | undefined;
  return {
    ok: true,
    route: String(d.route),
    reply: replyOf(d as { route: string; reply?: string }) ?? null,
    commandId: (d.commandId as string | undefined) ?? null,
    parse: !p ? null : p.ok
      ? { ok: true, dryRun: p.dryRun, ...p.command }
      : { ok: false, dryRun: p.dryRun, reason: p.reason, detail: p.detail },
    authorized: d.authorized ?? null,
    result: (d.result as Record<string, unknown> | undefined) ?? null,
  };
}
