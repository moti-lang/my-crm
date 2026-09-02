// cron-debt — תזכורות גבייה. רץ 08:30 בכל בוקר.
//
// לכל תלמידה עם יתרה שעברו 30 / 60 / 90 יום מהתשלום האחרון.
// **פעם אחת לכל סף.** האכיפה היא מפתח ייחודיות במסד ולא בדיקה בקוד:
//   debt:{student}:{threshold}:{last_paid_on}
// כשההורה משלמת, last_paid_on משתנה והמונה מתאפס — מחזור חוב חדש
// יקבל תזכורות, וחוב ישן לא יוצף.
import { adminClient } from '../_shared/supabase.ts';
import { loadTemplates, readSetting, automationEnabled, queueReminder, formatILS } from '../_shared/reminders.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async () => {
  const db = adminClient();

  try {
    if (!(await automationEnabled(db, 'debt_reminders'))) {
      return json({ queued: 0, skipped: 'האוטומציה כבויה' });
    }

    const thresholds = await readSetting<number[]>(db, 'debt_reminder_days', [30, 60, 90]);
    const templates = await loadTemplates(db);
    const template = templates.get('debt_reminder');
    if (!template) return json({ error: 'חסרה תבנית debt_reminder' }, 500);

    const { data: debtors, error } = await db.from('v_debtors').select('*');
    if (error) throw new Error(error.message);

    let queued = 0, skipped = 0;

    for (const d of (debtors ?? []) as Record<string, unknown>[]) {
      const phone = d.parent_phone as string | null;
      if (!phone) { skipped++; continue; }

      const days = Number(d.days_outstanding ?? 0);
      // הסף הגבוה ביותר שנחצה — לא שולחים שלוש הודעות ביום אחד.
      const crossed = thresholds.filter((t) => days >= t).sort((a, b) => b - a)[0];
      if (crossed === undefined) continue;

      const created = await queueReminder(db, {
        kind: 'debt',
        student_id: d.student_id as string,
        branch_id: d.branch_id as string,
        to_phone: phone,
        to_label: `${d.parent_name ?? ''} · ${d.full_name ?? ''}`.trim(),
        templateBody: template.body,
        vars: {
          student_name: String(d.full_name ?? ''),
          parent_name: String(d.parent_name ?? ''),
          branch: String(d.branch_name ?? ''),
          balance: formatILS(d.balance as number),
          total: formatILS(d.due as number),
          paid: formatILS(d.paid as number),
        },
        dedupeKey: `debt:${d.student_id}:${crossed}:${d.last_paid_on ?? 'never'}`,
      });
      if (created) queued++; else skipped++;
    }

    console.log(`[cron-debt] ${queued} תזכורות חדשות, ${skipped} דולגו`);
    return json({ queued, skipped });
  } catch (e) {
    console.error('[cron-debt] נכשל', e);
    return json({ error: 'יצירת תזכורות הגבייה נכשלה' }, 500);
  }
});
