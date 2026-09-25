import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useOpenAlerts, useWaHealth, useLastBackup } from '@/hooks/system';
import { useEnrollmentSettings, useSaveEnrollmentSettings, type EnrollmentPlan } from '@/hooks/enrollment';
import { humanError } from '@/lib/errors';
import { useState, useEffect } from 'react';
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

      <EnrollmentCard />

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

/** הרשמה: שם החוג, התקנון ומבנה התשלום. הבעלים עורכת; המסד מאמת שהסכומים מסתכמים. */
function EnrollmentCard() {
  const q = useEnrollmentSettings();
  const save = useSaveEnrollmentSettings();
  const [name, setName] = useState('');
  const [terms, setTerms] = useState('');
  const [plan, setPlan] = useState<Partial<EnrollmentPlan>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (q.data) { setName(q.data.program_name); setTerms(q.data.terms); setPlan(q.data.plan); } }, [q.data]);
  const n = (k: keyof EnrollmentPlan) => Number(plan[k] ?? 0);
  const sum = n('registration_fee') + n('installments') * n('installment_amount');
  const consistent = sum === n('annual_total') && n('first_charge') === n('registration_fee') + n('installment_amount');
  const num = (k: keyof EnrollmentPlan, label: string) => (
    <label className="block text-sm">{label}<input type="number" className="field mt-1" value={plan[k] ?? ''} onChange={(e) => setPlan({ ...plan, [k]: Number(e.target.value) })} /></label>
  );
  if (q.isLoading) return <section className="card p-4"><CardSkeleton rows={3} /></section>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-lg">הרשמה לחוג</h2>
      <p className="text-sm text-soft">דף ההרשמה הציבורי: <code className="text-xs">{q.data?.base_url}/enroll</code>. כל מה שכאן מופיע בדף ונאכף בהרשמה, בלי לגעת בקוד.</p>
      <label className="block text-sm">שם החוג<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {num('annual_total', 'עלות שנתית (₪)')}
        {num('registration_fee', 'דמי רישום (₪)')}
        {num('installments', 'מספר תשלומים')}
        {num('installment_amount', 'סכום כל תשלום (₪)')}
        {num('first_charge', 'החיוב הראשון (₪)')}
        {num('trial_days', 'חודש ניסיון (ימים)')}
        {num('cancel_refund', 'החזר בביטול (₪)')}
      </div>
      <label className="block text-sm">ייעוד דמי הרישום<input className="field mt-1" value={plan.registration_fee_purpose ?? ''} onChange={(e) => setPlan({ ...plan, registration_fee_purpose: e.target.value })} /></label>
      <p className={`text-sm ${consistent ? 'text-ok' : 'text-bad'}`} role="status">
        {consistent
          ? `✓ ${n('registration_fee')} + ${n('installments')} × ${n('installment_amount')} = ${n('annual_total')}, והחיוב הראשון = דמי רישום + תשלום אחד`
          : `✗ המבנה לא מסתכם: ${n('registration_fee')} + ${n('installments')} × ${n('installment_amount')} = ${sum}, ולא ${n('annual_total')} (או שהחיוב הראשון שגוי). ההרשמה תסרב עד שזה יתוקן.`}
      </p>
      <label className="block text-sm">התקנון (מוצג במלואו בדף ההרשמה)<textarea className="field mt-1 min-h-[14rem]" value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
      {msg && <p className={`text-sm ${msg.startsWith('נשמר') ? 'text-ok' : 'text-bad'}`} role="status">{msg}</p>}
      <button type="button" className="btn-primary" disabled={save.isPending || !consistent}
        onClick={async () => { setMsg(null); try { await save.mutateAsync({ program_name: name, terms, plan }); setMsg('נשמר.'); } catch (e) { setMsg(humanError(e)); } }}>
        {save.isPending ? 'שומרת…' : 'שמירה'}
      </button>
    </section>
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
            רץ כל יום ב-22:00 ונשמר בענן (30 האחרונים). כשל מופיע גם בהתראות המערכת למטה.
            להורדה או שחזור — פנייה למנהל המערכת.
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
