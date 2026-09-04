// cron-summary — סיכומים לבעלים.
//
// ?period=daily  (לפי settings.daily_summary_time)
// ?period=weekly (ראשון 09:00)
//
// הסיכום נכנס לתור התזכורות כמו כל הודעה אחרת: הוא מכבד שעות שקטות,
// והוא לא יוצא כשהחיבור נפול. סיכום שלא יצא יישאר בתור.
import { adminClient } from '../_shared/supabase.ts';
import { requireCronSecret } from '../_shared/guard.ts';
import { loadTemplates, readSetting, automationEnabled, queueReminder, formatILS } from '../_shared/reminders.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

function jerusalemDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const db = adminClient();
  const period = new URL(req.url).searchParams.get('period') === 'weekly' ? 'weekly' : 'daily';

  try {
    if (!(await automationEnabled(db, period === 'weekly' ? 'weekly_summary' : 'daily_summary'))) {
      return json({ queued: 0, skipped: 'האוטומציה כבויה' });
    }

    const ownerPhone = await readSetting<string>(db, 'owner_phone', '');
    if (!ownerPhone) return json({ error: 'לא הוגדר owner_phone' }, 500);

    const templates = await loadTemplates(db);
    const template = templates.get(period === 'weekly' ? 'owner_weekly' : 'owner_daily');
    if (!template) return json({ error: 'חסרה תבנית הסיכום' }, 500);

    const today = jerusalemDate();
    const since = period === 'weekly'
      ? jerusalemDate(new Date(Date.now() - 7 * 86400_000))
      : today;

    const [lessons, debtors, payments, leads, unanswered] = await Promise.all([
      db.from('v_lesson_summary').select('status').eq('lesson_date', today),
      db.from('v_debtors').select('balance'),
      db.from('payments').select('amount').gte('paid_on', since).is('deleted_at', null),
      db.from('students').select('id').eq('status', 'pending').gte('joined_on', since),
      db.from('unanswered_questions').select('id').eq('resolved', false),
    ]);

    const lessonRows = (lessons.data ?? []) as { status: string }[];
    const debtRows = (debtors.data ?? []) as { balance: number }[];
    const income = ((payments.data ?? []) as { amount: number }[])
      .reduce((s, p) => s + Number(p.amount), 0);
    const debt = debtRows.reduce((s, d) => s + Number(d.balance), 0);

    const created = await queueReminder(db, {
      kind: 'owner_summary',
      to_phone: ownerPhone,
      to_label: 'הניה · סיכום',
      templateBody: template.body,
      vars: {
        reported: String(lessonRows.filter((l) => l.status === 'reported').length),
        total: String(lessonRows.length),
        income: formatILS(income),
        debtors: String(debtRows.length),
        debt: formatILS(debt),
        new_leads: String((leads.data ?? []).length),
        unanswered: String((unanswered.data ?? []).length),
      } as Record<string, string>,
      // סיכום אחד ליום/לשבוע, גם אם ה-cron ירוץ פעמיים.
      dedupeKey: `summary:${period}:${today}`,
    });

    return json({ queued: created ? 1 : 0, period, duplicate: !created });
  } catch (e) {
    console.error('[cron-summary] נכשל', e);
    return json({ error: 'יצירת הסיכום נכשלה' }, 500);
  }
});
