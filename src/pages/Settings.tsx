import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useOpenAlerts, useWaHealth, useLastBackup } from '@/hooks/system';
import { WaHealthBadge } from '@/components/WaHealthBadge';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/format';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';

const SEVERITY_TONE: Record<string, string> = {
  critical: 'border-bad/40 bg-bad/10 text-bad',
  warning: 'border-warn/40 bg-warn/10 text-warn',
  info: 'border-rule bg-shade text-soft',
};

export function Settings() {
  const health = useWaHealth();
  const alerts = useOpenAlerts();
  const qc = useQueryClient();

  async function acknowledge(id: string) {
    await supabase.from('system_alerts').update({ acknowledged_at: new Date().toISOString() }).eq('id', id);
    await qc.invalidateQueries({ queryKey: ['system-alerts'] });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl">הגדרות</h1>

      <section className="card p-4">
        <h2 className="mb-3 text-lg">חיבור וואטסאפ</h2>
        {health.isLoading ? (
          <CardSkeleton rows={2} />
        ) : health.isError ? (
          <ErrorState error={health.error} onRetry={() => void health.refetch()} />
        ) : (
          <>
            <WaHealthBadge detailed />
            <dl className="mt-3 space-y-1 border-t border-rule pt-3 text-sm">
              <Row label="נבדק לאחרונה" value={formatDateTime(health.data?.checked_at)} />
              <Row label="תקין לאחרונה" value={formatDateTime(health.data?.last_ok_at)} />
              <Row label="כשלים רצופים" value={String(health.data?.consecutive_failures ?? 0)} />
              {health.data?.error && <Row label="שגיאה אחרונה" value={health.data.error} />}
            </dl>
            <p className="mt-3 border-t border-rule pt-3 text-xs text-soft">
              הבדיקה רצה כל 10 דקות, ובנוסף השרת מודיע מיד על שינוי מצב.
              כשהחיבור נפול, תזכורות נשארות בתור ואינן מסומנות כנשלחו.
            </p>
          </>
        )}
      </section>

      <BackupCard />

      <section>
        <h2 className="mb-2 text-lg">התראות מערכת</h2>
        {alerts.isLoading ? (
          <CardSkeleton rows={3} />
        ) : (alerts.data?.length ?? 0) === 0 ? (
          <EmptyState title="אין התראות פתוחות" hint="הכל תקין." />
        ) : (
          <ul className="space-y-2">
            {(alerts.data ?? []).map((a) => (
              <li key={a.id} className={`rounded-card border p-3 ${SEVERITY_TONE[a.severity] ?? SEVERITY_TONE.info}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{a.title}</p>
                    {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{a.body}</p>}
                    <p className="mt-1 text-xs opacity-70">{formatDateTime(a.created_at)}</p>
                  </div>
                  <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => void acknowledge(a.id)}>
                    סמן כטופל
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-lg">שאר ההגדרות</h2>
        <p className="text-sm text-soft">
          משתמשים והרשאות — במסך <Link to="/users" className="text-plum underline">משתמשים</Link>.
          עונות · קטגוריות · תבניות · שעות שקטות וחגים · גיבוי — נבנים בסבב 9.
        </p>
      </section>
    </div>
  );
}

/** הגיבוי היומי: מתי רץ לאחרונה, האם הצליח, והאם המייל יצא. אדום אחרי 26 שעות. */
function BackupCard() {
  const backup = useLastBackup();
  const b = backup.data;
  const ageH = b ? (Date.now() - new Date(b.at).getTime()) / 3_600_000 : Infinity;
  const stale = !b || ageH > 26;
  const tone = !b ? 'text-soft' : !b.ok ? 'text-bad' : stale ? 'text-warn' : 'text-ok';
  const MAIL: Record<string, string> = { sent: 'נשלח', failed: 'נכשל', off: 'לא מחובר עדיין' };
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-lg">גיבוי יומי</h2>
      {backup.isLoading ? <CardSkeleton rows={2} /> : backup.isError ? (
        <ErrorState error={backup.error} onRetry={() => void backup.refetch()} />
      ) : (
        <>
          <p className={`font-medium ${tone}`}>
            {!b ? 'עדיין לא רץ אף פעם' : !b.ok ? `הגיבוי האחרון נכשל: ${b.error ?? ''}` : stale ? `הגיבוי האחרון הצליח, אבל לפני יותר מיום (${Math.round(ageH)} שעות)` : 'הגיבוי האחרון הצליח'}
          </p>
          {b && (
            <dl className="mt-3 space-y-1 border-t border-rule pt-3 text-sm">
              <Row label="רץ" value={formatDateTime(b.at)} />
              <Row label="קובץ" value={b.name} />
              {b.ok && <Row label="תוכן" value={`${b.tables} טבלאות · ${b.rows} שורות · ${Math.round(b.size / 1024)} KB, אומת אחרי ההורדה`} />}
              <Row label="מייל" value={MAIL[b.mail] ?? b.mail} />
            </dl>
          )}
          <p className="mt-3 border-t border-rule pt-3 text-xs text-soft">
            רץ כל יום ב-22:00 ונשמר ב-Storage (30 האחרונים). כשל מופיע גם בהתראות המערכת למטה.
            הורדה: <code>npm run backup:pull</code>.
          </p>
        </>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-soft">{label}:</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(iso)} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })}`;
}
