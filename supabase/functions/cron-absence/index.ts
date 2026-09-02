// cron-absence — התראת נשירה. 20:00 בכל יום.
//
// תלמידה עם absence_alert_streak היעדרויות רצופות → התראה לבעלים,
// והצעת הודעה להורה. ההודעה להורה לא נשלחת אוטומטית: זו שיחה רגישה,
// והבעלים צריכה להחליט אם לשלוח אותה או להרים טלפון.
import { adminClient } from '../_shared/supabase.ts';
import { loadTemplates, readSetting, automationEnabled } from '../_shared/reminders.ts';
import { renderTemplate } from '../_shared/template.ts';
import { alertOwner } from '../_shared/alerts.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async () => {
  const db = adminClient();

  try {
    if (!(await automationEnabled(db, 'absence_alerts'))) {
      return json({ alerted: 0, skipped: 'האוטומציה כבויה' });
    }

    const streakThreshold = await readSetting<number>(db, 'absence_alert_streak', 3);
    const templates = await loadTemplates(db);
    const template = templates.get('absence_alert');

    const { data: streaks, error } = await db
      .from('v_absence_streaks').select('*').gte('absent_streak', streakThreshold);
    if (error) throw new Error(error.message);

    let alerted = 0;

    for (const s of (streaks ?? []) as Record<string, unknown>[]) {
      // התראה אחת לכל רצף. אותה תלמידה עם אותו רצף לא תתריע כל ערב.
      const { data: existing } = await db.from('system_alerts')
        .select('id').eq('kind', 'absence_streak')
        .contains('meta', { student_id: s.student_id, streak: s.absent_streak })
        .maybeSingle();
      if (existing) continue;

      const suggested = template
        ? renderTemplate(template.body, {
            student_name: String(s.full_name ?? ''),
            parent_name: String(s.parent_name ?? ''),
            branch: String(s.branch_name ?? ''),
          })
        : null;

      await alertOwner(db, {
        kind: 'absence_streak',
        severity: 'warning',
        title: `${s.full_name} נעדרה ${s.absent_streak} שיעורים רצופים`,
        body: [
          `סניף ${s.branch_name}. היעדרות אחרונה: ${s.last_absent_on ?? '—'}.`,
          suggested ? `\nהצעה להודעה להורה:\n${suggested}` : '',
        ].join(''),
        meta: {
          student_id: s.student_id,
          streak: s.absent_streak,
          parent_phone: s.parent_phone,
          suggested_message: suggested,
        },
      });
      alerted++;
    }

    return json({ alerted, checked: streaks?.length ?? 0 });
  } catch (e) {
    console.error('[cron-absence] נכשל', e);
    return json({ error: 'בדיקת הנשירה נכשלה' }, 500);
  }
});
