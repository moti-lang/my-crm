import { useMemo, useState } from 'react';
import { useLessonSummary, useAttendanceLinks, useIssueLink, useRevokeLink } from '@/hooks/attendance';
import { useBranches } from '@/hooks/queries';
import { formatDate, formatPercent, formatPhone } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { ConfirmDialog } from '@/pages/Expenses';

const today = () => new Date().toISOString().slice(0, 10);

export function Attendance() {
  const lessons = useLessonSummary();
  const branches = useBranches();
  const links = useAttendanceLinks();
  const issue = useIssueLink();
  const revoke = useRevokeLink();

  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const linkByBranch = useMemo(
    () => new Map((links.data ?? []).map((l) => [l.branch_id, l])),
    [links.data],
  );
  const todaysLesson = useMemo(
    () => new Map((lessons.data ?? []).filter((l) => l.lesson_date === today()).map((l) => [l.branch_id, l])),
    [lessons.data],
  );

  const unreported = (branches.data ?? []).filter((b) => {
    const l = todaysLesson.get(b.id);
    return l && l.status === 'pending';
  });

  if (lessons.isError) return <ErrorState error={lessons.error} onRetry={() => void lessons.refetch()} />;

  const sheetUrl = (token: string) => `${window.location.origin}/a/${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(sheetUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl">נוכחות</h1>

      {unreported.length > 0 && (
        <div className="rounded-card border border-bad/40 bg-bad/10 p-4 text-sm" role="alert">
          <p className="font-display text-base text-bad">
            {unreported.length} סניפים טרם דיווחו נוכחות היום
          </p>
          <p className="mt-1 text-ink">{unreported.map((b) => b.name).join(' · ')}</p>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-lg">סניפים</h2>
        {branches.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} rows={3} />)}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(branches.data ?? []).map((b) => {
              const link = linkByBranch.get(b.id);
              const lesson = todaysLesson.get(b.id);
              return (
                <div key={b.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base">{b.name}</h3>
                    <StatusChip lesson={lesson} />
                  </div>
                  <p className="mt-1 text-xs text-soft">
                    {b.supervisor_name ?? 'ללא אחראית'}
                    {b.supervisor_phone && (
                      <>
                        {' · '}
                        <span dir="ltr">{formatPhone(b.supervisor_phone)}</span>
                      </>
                    )}
                  </p>

                  {lesson && (
                    <p className="mt-2 text-sm">
                      {lesson.marked ?? 0} מתוך {lesson.expected ?? 0} סומנו
                      {(lesson.marked ?? 0) > 0 && (
                        <span className="text-soft">
                          {' '}· הגיעו {lesson.attended ?? 0}
                        </span>
                      )}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-rule pt-3">
                    {link ? (
                      <>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void copy(link.token)}>
                          {copied === link.token ? '✓ הועתק' : 'העתקת קישור'}
                        </button>
                        <a
                          className="btn-ghost px-2 py-1 text-xs"
                          href={sheetUrl(link.token)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          פתיחה
                        </a>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs text-bad" onClick={() => setConfirmRevoke(b.id)}>
                          ביטול והנפקה מחדש
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary px-2 py-1 text-xs"
                        onClick={() => void issue.mutateAsync(b.id)}
                        disabled={issue.isPending}
                      >
                        הנפקת קישור נוכחות
                      </button>
                    )}
                  </div>
                  {link?.last_used_at && (
                    <p className="mt-2 text-xs text-soft">שימוש אחרון: {formatDate(link.last_used_at)}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg">יומן שיעורים</h2>
        {lessons.isLoading ? (
          <CardSkeleton rows={6} />
        ) : (lessons.data?.length ?? 0) === 0 ? (
          <EmptyState title="אין עדיין שיעורים" hint="שיעורים נוצרים אוטומטית בכל לילה לפי ימי הפעילות." />
        ) : (
          <div className="card table-wrap">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-rule text-right text-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">סניף</th>
                  <th className="px-3 py-2 font-medium">סטטוס</th>
                  <th className="px-3 py-2 font-medium">הגיעו</th>
                  <th className="px-3 py-2 font-medium">אחוז</th>
                  <th className="px-3 py-2 font-medium">דווח ע"י</th>
                </tr>
              </thead>
              <tbody>
                {(lessons.data ?? []).slice(0, 60).map((l) => {
                  const marked = Number(l.marked ?? 0);
                  const attended = Number(l.attended ?? 0);
                  const pct = marked > 0 ? (attended / marked) * 100 : null;
                  return (
                    <tr key={l.lesson_id} className="border-b border-rule last:border-0">
                      <td className="px-3 py-2">{formatDate(l.lesson_date)}</td>
                      <td className="px-3 py-2">{l.branch_name}</td>
                      <td className="px-3 py-2"><StatusChip lesson={l} /></td>
                      <td className="px-3 py-2 tabular-nums">{marked > 0 ? `${attended}/${marked}` : '—'}</td>
                      <td className={`px-3 py-2 tabular-nums ${pct !== null && pct < 70 ? 'text-warn' : ''}`}>
                        {pct === null ? '—' : formatPercent(pct)}
                      </td>
                      <td className="px-3 py-2">{l.reported_by ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-soft">
        אחראית שלא דיווחה מקבלת תזכורת אוטומטית, ושלוש היעדרויות רצופות של תלמידה
        מייצרות התראה לבעלים. שניהם רצים אוטומטית, בכפוף לשעות השקטות.
      </p>

      {confirmRevoke && (
        <ConfirmDialog
          title="לבטל את הקישור הקיים?"
          body="הקישור הנוכחי יפסיק לעבוד מיד, וייווצר קישור חדש שצריך לשלוח לאחראית."
          busy={revoke.isPending || issue.isPending}
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            await revoke.mutateAsync(confirmRevoke);
            await issue.mutateAsync(confirmRevoke);
            setConfirmRevoke(null);
          }}
        />
      )}
    </div>
  );
}

function StatusChip({ lesson }: { lesson: { status: string | null } | undefined }) {
  if (!lesson) return <span className="rounded-full bg-shade px-2 py-0.5 text-xs text-soft">אין שיעור</span>;
  if (lesson.status === 'reported') return <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs text-ok">דווח</span>;
  if (lesson.status === 'cancelled') return <span className="rounded-full bg-shade px-2 py-0.5 text-xs text-soft">בוטל</span>;
  return <span className="rounded-full bg-bad/15 px-2 py-0.5 text-xs text-bad">טרם דווח</span>;
}
