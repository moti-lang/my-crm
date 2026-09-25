import { useEffect, useState } from 'react';
import { useStudentPayments, useStudentProductions, STATUS_LABEL, STATUS_TONE } from '@/hooks/students';
import { formatILS, formatDate, formatPhone } from '@/lib/format';
import { PaymentForm } from '@/components/PaymentForm';
import { PaymentLinkButton } from '@/components/PaymentLinkButton';
import { useInstallmentProgress, useCancelEnrollment } from '@/hooks/enrollment';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import type { Views } from '@/lib/database.types';

type Student = Views<'v_student_overview'>;

const METHOD_LABEL: Record<string, string> = {
  cash: 'מזומן', transfer: 'העברה', bit: 'ביט', credit: 'אשראי', check: 'צ׳ק', other: 'אחר',
};

export function StudentDrawer({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const payments = useStudentPayments(student?.id ?? null);
  const productions = useStudentProductions(student?.id ?? null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!student) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [student, onClose]);

  if (!student) return null;

  const due = Number(student.due ?? 0);
  const progressQ = useInstallmentProgress(student.id ?? null);
  const inst = progressQ.data ?? null;
  const { profile } = useAuth();
  const cancelEnrollment = useCancelEnrollment();
  const trialEnd = student.trial_started_on ? new Date(new Date(student.trial_started_on).getTime() + 30 * 86400_000) : null;
  const inTrial = Boolean(trialEnd && trialEnd >= new Date(new Date().toDateString()) && !student.cancelled_at);
  const paid = Number(student.paid ?? 0);
  const balance = Number(student.balance ?? 0);
  const progress = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
  // עמודות של view מדווחות תמיד כ-nullable, גם כשהעמודה שמתחת NOT NULL.
  const status = student.status ?? 'active';

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-ink/30"
        onClick={onClose}
        role="presentation"
      />
      <aside
        className="fixed inset-y-0 left-0 z-40 flex w-full flex-col bg-card shadow-pop md:w-[30rem]"
        role="dialog"
        aria-modal="true"
        aria-label={`כרטיס התלמידה ${student.full_name}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-rule p-4">
          <div>
            <h2 className="font-display text-xl">{student.full_name}</h2>
            <p className="mt-0.5 text-sm text-soft">
              {student.branch_name}
              {student.grade ? ` · כיתה ${student.grade}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TONE[status]}`}>
              {STATUS_LABEL[status]}
            </span>
            <button type="button" onClick={onClose} className="btn-ghost px-2 py-1" aria-label="סגירה">
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <Section title="מצב תשלומים">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-soft">שולם {formatILS(paid)} מתוך {formatILS(due)}</span>
              <span className={`font-display tabular-nums ${balance > 0 ? 'text-bad' : 'text-ok'}`}>
                {balance > 0 ? `נותרו ${formatILS(balance)}` : 'שולם במלואו'}
              </span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-shade"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="התקדמות תשלומים"
            >
              <div className={`h-full ${balance > 0 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${progress}%` }} />
            </div>
            {inst && Number(inst.registration_fee) > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-field bg-shade/60 p-3 text-xs">
                <dt className="text-soft">דמי רישום</dt><dd className="tabular-nums">{formatILS(inst.registration_paid)} / {formatILS(inst.registration_fee)}</dd>
                <dt className="text-soft">שכר לימוד</dt><dd className="tabular-nums">{formatILS(inst.tuition_paid)} / {formatILS(inst.tuition)}</dd>
                {inst.installments_total ? (<>
                  <dt className="text-soft">תשלומים</dt>
                  <dd className="font-medium">{inst.installments_paid ?? 0} מתוך {inst.installments_total}{inst.installment_amount ? ` · ${formatILS(inst.installment_amount)} כל אחד` : ''}</dd>
                </>) : null}
                {student.terms_accepted_at && (<><dt className="text-soft">אישור תקנון</dt><dd>{new Date(student.terms_accepted_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}</dd></>)}
                {student.trial_started_on && trialEnd && (<><dt className="text-soft">חודש ניסיון</dt><dd>{formatDate(student.trial_started_on)} – {formatDate(trialEnd.toISOString().slice(0, 10))}{student.cancelled_at ? ' · בוטל' : inTrial ? '' : ' · הסתיים'}</dd></>)}
                {student.refund_amount != null && Number(student.refund_amount) > 0 && (<><dt className="text-soft">החזר</dt><dd className="tabular-nums">{formatILS(student.refund_amount)}</dd></>)}
              </dl>
            )}
            {profile?.role === 'owner' && student.trial_started_on && !student.cancelled_at && student.id && (
              <div className="mt-2">
                <button type="button" className="btn-ghost w-full text-bad" disabled={!inTrial || cancelEnrollment.isPending}
                  title={inTrial ? 'ביטול בתוך חודש הניסיון — זיכוי מדמי הרישום לפי התקנון' : 'חודש הניסיון הסתיים. לפי התקנון, אחרי חודש הניסיון לא ניתן לבטל.'}
                  onClick={() => { if (window.confirm(`לבטל את ההרשמה של ${student.full_name}? תירשם הפסקה וזיכוי מדמי הרישום לפי התקנון.`)) void cancelEnrollment.mutateAsync(student.id as string); }}>
                  {cancelEnrollment.isPending ? 'מבטלת…' : 'ביטול הרשמה'}
                </button>
                {!inTrial && <p className="mt-1 text-xs text-soft">חודש הניסיון הסתיים ב-{trialEnd ? formatDate(trialEnd.toISOString().slice(0, 10)) : ''}. לפי התקנון, אחרי חודש הניסיון לא ניתן לבטל.</p>}
                {cancelEnrollment.error != null && <p className="mt-1 text-xs text-bad" role="alert">{humanError(cancelEnrollment.error)}</p>}
                {cancelEnrollment.data && <p className="mt-1 text-xs text-ok">ההרשמה בוטלה. זיכוי {formatILS(cancelEnrollment.data.refund)}.</p>}
              </div>
            )}
            {Number(student.discount ?? 0) > 0 && (
              <p className="mt-2 text-xs text-soft">
                הנחה {formatILS(student.discount)}
                {student.discount_reason ? ` · ${student.discount_reason}` : ''}
              </p>
            )}

            {adding && student.id ? (
              <div className="mt-3">
                <PaymentForm
                  studentId={student.id}
                  balance={balance}
                  onDone={() => setAdding(false)}
                  onCancel={() => setAdding(false)}
                />
              </div>
            ) : (
              <>
                <button type="button" className="btn-ghost mt-3 w-full" onClick={() => setAdding(true)}>
                  + רישום תשלום
                </button>
                {student.id && <PaymentLinkButton studentId={student.id} balance={balance} hasPhone={Boolean(student.parent_phone)} />}
              </>
            )}

            {payments.isLoading ? (
              <p className="mt-3 text-sm text-soft">טוען תשלומים…</p>
            ) : (payments.data?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-soft">טרם נרשמו תשלומים.</p>
            ) : (
              <ul className="mt-3 divide-y divide-rule border-t border-rule">
                {(payments.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      {formatDate(p.paid_on)}
                      <span className="text-soft"> · {METHOD_LABEL[p.method] ?? p.method}</span>
                      {p.covers_note && <span className="text-soft"> · {p.covers_note}</span>}
                    </span>
                    <span className="tabular-nums">{formatILS(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="נוכחות">
            {student.lessons_total && Number(student.lessons_total) > 0 ? (
              <p className="text-sm">
                <span className="font-display text-lg tabular-nums">{student.attendance_pct}%</span>
                <span className="text-soft">
                  {' '}· הגיעה ל-{student.lessons_attended} מתוך {student.lessons_total} שיעורים
                </span>
              </p>
            ) : (
              <p className="text-sm text-soft">אין עדיין נתוני נוכחות.</p>
            )}
          </Section>

          <Section title="פרטי קשר">
            <dl className="space-y-1 text-sm">
              <Row label="הורה" value={student.parent_name} />
              <Row label="טלפון" value={formatPhone(student.parent_phone)} ltr />
              <Row label="הצטרפה" value={formatDate(student.joined_on)} />
              {student.stopped_on && <Row label="הפסיקה" value={formatDate(student.stopped_on)} />}
              {student.stop_reason && <Row label="סיבה" value={student.stop_reason} />}
              <Row label="אישור צילום" value={student.photo_consent ? 'יש' : 'אין'} />
            </dl>
          </Section>

          <Section title="השתתפות בהפקות">
            {productions.isLoading ? (
              <p className="text-sm text-soft">טוען…</p>
            ) : (productions.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-soft">
                {student.photo_consent ? 'לא משתתפת בהפקות.' : 'אין אישור צילום — לא ניתן לצרף להפקה.'}
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(productions.data ?? []).map((c) => (
                  <li key={c.productions?.id}>
                    {c.productions?.name}
                    {c.role_name && <span className="text-soft"> · {c.role_name}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {student.notes && (
            <Section title="הערות">
              <p className="whitespace-pre-wrap text-sm">{student.notes}</p>
            </Section>
          )}
        </div>

        <footer className="border-t border-rule p-4">
          <p className="text-xs text-soft">
            שליחת תזכורת נעשית ממסך הגבייה. קביעת מעקב והפסקת השתתפות נבנים בסבב 6.
          </p>
        </footer>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-soft">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="text-soft">{label}:</dt>
      <dd {...(ltr ? { dir: 'ltr' as const } : {})}>{value ?? '—'}</dd>
    </div>
  );
}
