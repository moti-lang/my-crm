// cron-lessons — יוצר את שיעורי המחר, 02:00 בכל לילה.
//
// לכל סניף פעיל שבו weekdays מכיל את יום השבוע של מחר. יצירה מראש
// מאפשרת ל-cron-attendance-watch לדעת על מי להתריע, ולאחראית לפתוח
// את הקישור ולמצוא רשימה מוכנה.
//
// rpc_attendance_sheet יוצר שיעור בעצמו אם הוא חסר — הרשת השנייה,
// למקרה שה-cron לא רץ. עדיף שהאחראית תדווח מאשר שתיתקל במסך ריק.
import { adminClient } from '../_shared/supabase.ts';
import { requireCronSecret } from '../_shared/guard.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/** יום בשבוע לפי שעון ישראל: 0=ראשון .. 6=שבת */
function jerusalemWeekday(d: Date): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[label] ?? 0;
}

function jerusalemDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

Deno.serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const db = adminClient();

  try {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const weekday = jerusalemWeekday(tomorrow);
    const date = jerusalemDate(tomorrow);

    // חג — אין שיעורים.
    const { data: holiday } = await db.from('holidays').select('day').eq('day', date).maybeSingle();
    if (holiday) {
      return json({ created: 0, skipped: 'חג', date });
    }

    const { data: branches, error } = await db
      .from('branches')
      .select('id, name, weekdays')
      .is('deleted_at', null)
      .eq('is_active', true);
    if (error) throw new Error(error.message);

    const due = (branches ?? []).filter((b: { weekdays: number[] | null }) =>
      (b.weekdays ?? []).includes(weekday),
    );
    if (due.length === 0) return json({ created: 0, date, weekday });

    // unique (branch_id, lesson_date) מונע כפילות אם ה-cron רץ פעמיים.
    const { data: inserted, error: insertError } = await db
      .from('lessons')
      .upsert(
        due.map((b: { id: string }) => ({ branch_id: b.id, lesson_date: date, status: 'pending' })),
        { onConflict: 'branch_id,lesson_date', ignoreDuplicates: true },
      )
      .select('id');
    if (insertError) throw new Error(insertError.message);

    console.log(`[cron-lessons] ${inserted?.length ?? 0} שיעורים נוצרו ל-${date}`);
    return json({ created: inserted?.length ?? 0, date, branches: due.map((b: { name: string }) => b.name) });
  } catch (e) {
    console.error('[cron-lessons] נכשל', e);
    return json({ error: 'יצירת השיעורים נכשלה' }, 500);
  }
});
