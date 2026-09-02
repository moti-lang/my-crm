import { aiProvider, type CommandContext } from './ai.ts';
import { authorizeCommand, looksLikeCommand, READ_ONLY_INTENTS, type AuthorizedNumber } from './authorize.ts';
import type { ParseOutcome } from './command-schema.ts';

/**
 * נתב ההודעות הנכנסות (סעיף 4.2).
 *
 * מוצא מ-wa-webhook כפונקציה עם תלות מוזרקת (db), כדי שאפשר יהיה
 * להריץ אותו מול מסד מזויף שמתעד כל כתיבה. זו הדרך היחידה להוכיח
 * את הטענה "מסלול כישלון פרסור לא כותב כלום" — ולא להסתפק בקריאת הקוד.
 */

export type Db = { from: (t: string) => any };

export type RouteDecision =
  | { route: 'command'; caller: AuthorizedNumber; parse: ParseOutcome;
      authorized?: { allowed: boolean; reason?: string; message?: string };
      needsConfirmation?: boolean; commandId?: string; reply?: string }
  | { route: 'command_parse_failed'; caller: AuthorizedNumber; parse: ParseOutcome }
  | { route: 'confirmed'; caller: AuthorizedNumber; result: Record<string, unknown>; reply: string }
  | { route: 'declined'; caller: AuthorizedNumber; reply: string }
  | { route: 'undo'; caller: AuthorizedNumber; result: Record<string, unknown>; reply: string }
  | { route: 'customer'; phone: string; rejectedAttempt: boolean };

/** תשובות אישור וביטול (סעיף 4.3.א). */
const YES = new Set(['כן', 'אישור', 'אשר', 'אשרי', '✅', '1', 'ok', 'אוקיי']);
const NO = new Set(['לא', 'בטל', 'ביטול', 'בטלי', '❌', '0']);
const UNDO = new Set(['בטל', 'ביטול', 'בטלי']);

/** כרטיס האישור (סעיף 4.3.2). */
export function confirmationCard(intent: string, fields: Record<string, unknown>, summary: string): string {
  const label: Record<string, string> = {
    expense: 'הוצאה', income: 'הכנסה', payment: 'תשלום',
    new_student: 'תלמידה חדשה', update_student: 'עדכון תלמידה', reminder: 'תזכורת',
  };
  const lines = [`זיהיתי ${label[intent] ?? intent}:`];
  const show: [string, unknown][] = [
    ['סכום', fields.amount !== undefined && fields.amount !== null ? `₪${fields.amount}` : null],
    ['תלמידה', fields.student_name ?? fields.full_name],
    ['סניף', fields.branch],
    ['קטגוריה', fields.category],
    ['ספק', fields.vendor],
    ['תאריך', fields.date],
  ];
  for (const [k, v] of show) if (v !== null && v !== undefined && v !== '') lines.push(`${k}: ${v}`);
  if (lines.length === 1) lines.push(summary);
  lines.push('', 'לאישור השיבי: כן', 'לביטול: לא');
  return lines.join('\n');
}

export type RouterDeps = {
  /** מתריע לבעלים. מוזרק כדי שהבדיקה תוכל לתפוס אותו. */
  alert: (a: { kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body?: string; meta?: unknown }) => Promise<void>;
};

/** ההקשר שנשלח למודל: שמות בלבד. */
async function loadContext(db: Db, text: string): Promise<CommandContext> {
  const [branches, students, categories] = await Promise.all([
    db.from('branches').select('name').is('deleted_at', null),
    db.from('v_student_overview').select('full_name, branch_name').eq('status', 'active'),
    db.from('categories').select('name').eq('is_active', true),
  ]);

  return {
    text,
    today: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()),
    branches: (branches.data ?? []).map((b: { name: string }) => b.name),
    students: (students.data ?? []).map((s: { full_name: string; branch_name: string }) => ({
      full_name: s.full_name, branch: s.branch_name,
    })),
    categories: [...new Set((categories.data ?? []).map((c: { name: string }) => c.name))] as string[],
  };
}

export async function routeIncoming(
  db: Db,
  deps: RouterDeps,
  message: { phone: string; body: string },
): Promise<RouteDecision> {
  const { data: caller } = await db
    .from('authorized_numbers')
    .select('phone, label, scope, branch_id, can_delete, is_active, branches(name)')
    .eq('phone', message.phone)
    .eq('is_active', true)
    .maybeSingle();

  // ─────────── מספר לא מורשה ───────────
  if (!caller) {
    const attempted = looksLikeCommand(message.body);
    if (attempted) {
      // ניסיון פקודה ממספר לא מוכר נרשם ומתריע. זה כן כתיבה — היא
      // חלק מה-allowlist, לא ממסלול הפרסור.
      await db.from('commands').insert({
        phone: message.phone,
        raw_text: message.body,
        status: 'rejected',
        error: 'מספר לא מורשה',
      });
      await deps.alert({
        kind: 'unauthorized_command',
        severity: 'warning',
        title: 'ניסיון פקודה ממספר לא מורשה',
        body: `${message.phone} שלח: ${message.body.slice(0, 140)}`,
        meta: { phone: message.phone },
      });
    }
    // ובכל מקרה ממשיכים למסלול הלקוחות.
    return { route: 'customer', phone: message.phone, rejectedAttempt: attempted };
  }

  // ─────────── מספר מורשה ───────────
  const authorizedNumber: AuthorizedNumber = {
    phone: caller.phone,
    label: caller.label,
    scope: caller.scope,
    branch_id: caller.branch_id,
    branch_name: caller.branches?.name ?? null,
    can_delete: caller.can_delete,
    is_active: caller.is_active,
  };

  const text = message.body.trim();

  // ─────────── א. יש פקודה ממתינה? ───────────
  const { data: pending } = await db
    .from('commands')
    .select('id, intent, parsed, raw_text')
    .eq('phone', message.phone)
    .eq('status', 'pending_confirm')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending) {
    if (YES.has(text.toLowerCase())) {
      // ★ הביצוע אטומי במסד. שתי "כן" בו זמנית → כתיבה אחת בלבד.
      const { data: result } = await db.rpc('rpc_execute_command', { p_command_id: pending.id });
      const r = (result ?? {}) as Record<string, unknown>;
      return {
        route: 'confirmed', caller: authorizedNumber, result: r,
        reply: r.ok
          ? `✅ נרשם. ${pending.parsed?.human_summary ?? ''}. לביטול כתבי: בטל`
          : r.reason === 'expired'
            ? 'הבקשה פגה. אפשר לשלוח אותה שוב.'
            : 'הפעולה כבר בוצעה.',
      };
    }
    if (NO.has(text.toLowerCase())) {
      await db.from('commands').update({ status: 'cancelled' }).eq('id', pending.id);
      return { route: 'declined', caller: authorizedNumber, reply: 'בוטל, לא נשמר כלום.' };
    }
    // טקסט אחר — rpc_create_pending_command יבטל את הקודמת בעצמו.
  }

  // ─────────── ב. "בטל" בלי פקודה ממתינה ───────────
  if (!pending && UNDO.has(text.toLowerCase())) {
    const { data: result } = await db.rpc('rpc_cancel_last_command', { p_phone: message.phone });
    const r = (result ?? {}) as Record<string, unknown>;
    return {
      route: 'undo', caller: authorizedNumber, result: r,
      reply: r.ok ? '↩️ בוטל.' : String(r.message ?? 'אין פעולה אחרונה לביטול.'),
    };
  }

  // ─────────── ג. פרסור ───────────
  const ctx = await loadContext(db, text);
  const parse = await aiProvider().parseCommand(ctx);

  // ★ מסלול כישלון הפרסור. אין כאן ולו כתיבה אחת — לא commands,
  // לא audit_log, ולא לוג חלקי. הכישלון מוחזר לקורא ותו לא.
  if (!parse.ok) {
    return { route: 'command_parse_failed', caller: authorizedNumber, parse };
  }

  const verdict = authorizeCommand(authorizedNumber, parse.command);

  if (!verdict.allowed) {
    return {
      route: 'command', caller: authorizedNumber, parse,
      authorized: { allowed: false, reason: verdict.reason, message: verdict.message },
      needsConfirmation: false, reply: verdict.message,
    };
  }

  // שאילתה היא קריאה בלבד ואינה דורשת אישור (סעיף 4.3.2).
  if (READ_ONLY_INTENTS.has(parse.command.intent)) {
    return {
      route: 'command', caller: authorizedNumber, parse,
      authorized: { allowed: true }, needsConfirmation: false,
    };
  }

  // שדה קריטי חסר — שואלים ולא שומרים פקודה ממתינה.
  if (parse.command.missing.length > 0) {
    return {
      route: 'command', caller: authorizedNumber, parse,
      authorized: { allowed: true }, needsConfirmation: false,
      reply: `חסר ${parse.command.missing.join(', ')}. אפשר לשלוח שוב עם הפרט הזה.`,
    };
  }

  // ★ הפקודה הממתינה נשמרת במסד, לא בזיכרון. הפונקציה הזו מתה
  //   בין הודעה להודעה — state בתהליך פשוט יאבד.
  const { data: commandId } = await db.rpc('rpc_create_pending_command', {
    p_phone: message.phone,
    p_raw_text: text,
    p_parsed: parse.command,
    p_intent: parse.command.intent,
  });

  return {
    route: 'command', caller: authorizedNumber, parse,
    authorized: { allowed: true }, needsConfirmation: true,
    commandId: commandId as string,
    reply: confirmationCard(parse.command.intent, parse.command.fields, parse.command.human_summary),
  };
}
