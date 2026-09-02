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
      needsConfirmation?: boolean }
  | { route: 'command_parse_failed'; caller: AuthorizedNumber; parse: ParseOutcome }
  | { route: 'customer'; phone: string; rejectedAttempt: boolean };

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

  const ctx = await loadContext(db, message.body);
  const parse = await aiProvider().parseCommand(ctx);

  // ★ מסלול כישלון הפרסור. אין כאן ולו כתיבה אחת — לא commands,
  // לא audit_log, ולא לוג חלקי. הכישלון מוחזר לקורא ותו לא.
  if (!parse.ok) {
    return { route: 'command_parse_failed', caller: authorizedNumber, parse };
  }

  const verdict = authorizeCommand(authorizedNumber, parse.command);

  return {
    route: 'command',
    caller: authorizedNumber,
    parse,
    authorized: verdict.allowed
      ? { allowed: true }
      : { allowed: false, reason: verdict.reason, message: verdict.message },
    // שאילתה היא קריאה בלבד ואינה דורשת אישור (סעיף 4.3.2).
    needsConfirmation: verdict.allowed && !READ_ONLY_INTENTS.has(parse.command.intent),
  };
}
