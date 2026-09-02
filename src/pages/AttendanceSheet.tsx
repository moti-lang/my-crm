import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import type { Enums } from '@/lib/database.types';

/**
 * מסך האחראית — ציבורי, ללא התחברות, ללא ניווט.
 *
 * כל הגישה לנתונים עוברת בשתי פונקציות RPC. הדף הזה לא נוגע באף טבלה,
 * ומה שהוא מקבל הוא שמות בלבד: אין בו טלפונים, כתובות או כסף.
 */

type Mark = Enums<'attendance_mark'>;
type Student = { id: string; full_name: string; mark: Mark | null };
type Sheet = {
  ok: true;
  branch_name: string;
  supervisor_name: string | null;
  lesson_date: string;
  lesson_id: string;
  already_reported: boolean;
  students: Student[];
};
type SheetError = { ok: false; error: string };

const OPTIONS: { mark: Mark; label: string; tone: string }[] = [
  { mark: 'present', label: 'הגיעה',    tone: 'bg-ok text-white border-ok' },
  { mark: 'late',    label: 'איחרה',    tone: 'bg-warn text-white border-warn' },
  { mark: 'absent',  label: 'לא הגיעה', tone: 'bg-bad text-white border-bad' },
];

export function AttendanceSheet() {
  const { token } = useParams<{ token: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('rpc_attendance_sheet', {
        p_token: token ?? '',
      });
      if (!alive) return;
      if (rpcError) {
        setError('לא הצלחנו לטעון את הרשימה. נסי לרענן.');
      } else {
        const result = data as unknown as Sheet | SheetError;
        if (result?.ok) {
          setSheet(result);
          setMarks(
            Object.fromEntries(
              result.students.filter((s) => s.mark).map((s) => [s.id, s.mark as Mark]),
            ),
          );
        } else {
          setError(result?.error ?? 'הקישור אינו פעיל, פני לניהול');
        }
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [token]);

  const total = sheet?.students.length ?? 0;
  const markedCount = useMemo(
    () => (sheet?.students ?? []).filter((s) => marks[s.id]).length,
    [sheet, marks],
  );

  async function save() {
    if (!sheet) return;
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('rpc_attendance_submit', {
      p_token: token ?? '',
      p_lesson: sheet.lesson_id,
      p_marks: sheet.students
        .filter((s) => marks[s.id])
        .map((s) => ({ student_id: s.id, mark: marks[s.id] })) as never,
    });
    const result = data as unknown as { ok: boolean; error?: string } | null;
    if (rpcError || !result?.ok) {
      setError(result?.error ?? 'השמירה נכשלה. נסי שוב.');
      setSaving(false);
      return;
    }
    setSaved(true);
    setSaving(false);
  }

  if (loading) {
    return <Shell><p className="text-center text-soft">טוען…</p></Shell>;
  }

  if (error && !sheet) {
    return (
      <Shell>
        <div className="card p-6 text-center">
          <p className="font-display text-lg text-bad">{error}</p>
        </div>
      </Shell>
    );
  }

  if (saved) {
    return (
      <Shell>
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-ok">תודה רבה 🌸</p>
          <p className="mt-2 text-sm text-soft">
            הנוכחות נשמרה. אפשר לחזור לקישור ולתקן עד סוף היום.
          </p>
          <button type="button" className="btn-ghost mt-5" onClick={() => setSaved(false)}>
            חזרה לרשימה
          </button>
        </div>
      </Shell>
    );
  }

  if (!sheet) return null;

  return (
    <Shell>
      <header className="mb-4 text-center">
        <h1 className="font-display text-xl">{sheet.branch_name}</h1>
        <p className="mt-0.5 text-sm text-soft">{formatDate(sheet.lesson_date)}</p>
        {sheet.already_reported && (
          <p className="mt-2 rounded-field bg-shade px-3 py-1.5 text-xs text-soft">
            הנוכחות כבר דווחה היום. אפשר לעדכן.
          </p>
        )}
      </header>

      <button
        type="button"
        className="btn-ghost mb-3 w-full"
        onClick={() =>
          setMarks(Object.fromEntries(sheet.students.map((s) => [s.id, 'present' as Mark])))
        }
      >
        סימון הכל כהגיעו
      </button>

      <ul className="space-y-2 pb-2">
        {sheet.students.map((s) => (
          <li key={s.id} className="card p-3">
            <p className="mb-2 text-base">{s.full_name}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {OPTIONS.map((o) => {
                const active = marks[s.id] === o.mark;
                return (
                  <button
                    key={o.mark}
                    type="button"
                    aria-pressed={active}
                    className={[
                      'rounded-btn border py-2.5 text-sm transition-colors',
                      active ? o.tone : 'border-rule bg-card text-soft',
                    ].join(' ')}
                    onClick={() => setMarks((m) => ({ ...m, [s.id]: o.mark }))}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <div className="sticky bottom-0 mt-2 -mx-4 border-t border-rule bg-paper px-4 pb-4 pt-3">
        <p className="mb-2 text-center text-sm text-soft" role="status">
          {markedCount} מתוך {total} סומנו
        </p>
        {error && <p className="mb-2 text-center text-sm text-bad" role="alert">{error}</p>}
        <button
          type="button"
          className="btn-primary w-full py-3 text-base"
          onClick={() => void save()}
          disabled={saving || markedCount === 0}
        >
          {saving ? 'שומר…' : 'שמירת הנוכחות'}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-md px-4 py-5">{children}</div>
    </div>
  );
}
