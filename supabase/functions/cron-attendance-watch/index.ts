// cron-attendance-watch — תזכורת לאחראית שלא דיווחה. כל 30 דקות.
//
// שיעור שנשאר pending אחרי attendance_nudge_minutes משעת השיעור →
// תזכורת לאחראית עם הקישור. אחרי 4 שעות → התראה לבעלים, כי אם
// האחראית לא הגיבה לתזכורת, מישהי צריכה להתקשר.
import { adminClient } from '../_shared/supabase.ts';
import { requireCronSecret } from '../_shared/guard.ts';
import { loadTemplates, readSetting, automationEnabled, queueReminder } from '../_shared/reminders.ts';
import { alertOwner } from '../_shared/alerts.ts';
import { env } from '../_shared/env.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

const OWNER_ALERT_AFTER_MINUTES = 240;

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const db = adminClient();

  try {
    if (!(await automationEnabled(db, 'attendance_nudge'))) {
      return json({ queued: 0, skipped: 'האוטומציה כבויה' });
    }

    const nudgeAfter = await readSetting<number>(db, 'attendance_nudge_minutes', 120);
    const templates = await loadTemplates(db);
    const template = templates.get('supervisor_nudge');
    if (!template) return json({ error: 'חסרה תבנית supervisor_nudge' }, 500);

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const { data: pending, error } = await db
      .from('lessons')
      .select('id, branch_id, lesson_date, branches(name, supervisor_name, supervisor_phone, lesson_time)')
      .eq('lesson_date', today)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);

    const siteUrl = env('SITE_URL') ?? '';
    let queued = 0, alerted = 0;

    for (const lesson of (pending ?? []) as Record<string, any>[]) {
      const branch = lesson.branches;
      if (!branch?.supervisor_phone) continue;

      // דקות שעברו משעת השיעור
      const lessonTime = String(branch.lesson_time ?? '16:00');
      const started = new Date(`${lesson.lesson_date}T${lessonTime}+03:00`);
      const minutesSince = (Date.now() - started.getTime()) / 60000;
      if (minutesSince < nudgeAfter) continue;

      const { data: link } = await db
        .from('attendance_links').select('token')
        .eq('branch_id', lesson.branch_id).eq('is_active', true).maybeSingle();

      const created = await queueReminder(db, {
        kind: 'attendance',
        branch_id: lesson.branch_id,
        to_phone: branch.supervisor_phone,
        to_label: `${branch.supervisor_name ?? ''} · ${branch.name ?? ''}`.trim(),
        templateBody: template.body,
        vars: {
          parent_name: String(branch.supervisor_name ?? ''),
          branch: String(branch.name ?? ''),
          lesson_date: String(lesson.lesson_date),
          link: link?.token ? `${siteUrl}/a/${link.token}` : '',
        },
        // פעם אחת לשיעור. לא מזכירים כל חצי שעה.
        dedupeKey: `nudge:${lesson.id}`,
      });
      if (created) queued++;

      if (minutesSince >= OWNER_ALERT_AFTER_MINUTES) {
        const { data: existing } = await db.from('system_alerts')
          .select('id').eq('kind', 'attendance_missing')
          .contains('meta', { lesson_id: lesson.id }).maybeSingle();
        if (!existing) {
          await alertOwner(db, {
            kind: 'attendance_missing',
            severity: 'warning',
            title: `נוכחות לא דווחה בסניף ${branch.name}`,
            body: `עברו יותר מ-4 שעות משעת השיעור והאחראית ${branch.supervisor_name ?? ''} טרם דיווחה.`,
            meta: { lesson_id: lesson.id, branch_id: lesson.branch_id },
          });
          alerted++;
        }
      }
    }

    return json({ queued, alerted, pending: pending?.length ?? 0 });
  } catch (e) {
    console.error('[cron-attendance-watch] נכשל', e);
    return json({ error: 'בדיקת הנוכחות נכשלה' }, 500);
  }
});
