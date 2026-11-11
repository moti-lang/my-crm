import { useEffect, useState } from 'react';
import { useStudentPayments, useStudentProductions, useStudentFlags, useDeleteStudent, useRenameStudent, useStudentNameHistory,
  useDiscountPreview, useApplyDiscount, useStudentDiscountHistory, usePaymentVoidHistory, useVoidPayment, STATUS_LABEL, STATUS_TONE,
  type VoidKind } from '@/hooks/students';
import { StudentTags } from '@/components/StudentTags';
import { StandingOrderPanel } from '@/components/StandingOrderPanel';
import { useStandingOrders } from '@/hooks/standing';
import { formatILS, formatDate, formatDateTime, formatPhone } from '@/lib/format';
import { NAME_RE, awaitsFirstCharge } from '@/lib/enrollment';
import { PaymentForm } from '@/components/PaymentForm';
import { PaymentLinkButton } from '@/components/PaymentLinkButton';
import { RenewEnrollmentLinkButton } from '@/components/RenewEnrollmentLinkButton';
import { useInstallmentProgress, useCancelEnrollment, useCancelEnrollmentOverride } from '@/hooks/enrollment';
import { useAuth } from '@/auth/AuthProvider';
import { humanError } from '@/lib/errors';
import type { Views } from '@/lib/database.types';

type Student = Views<'v_student_overview'>;

const METHOD_LABEL: Record<string, string> = {
  cash: 'מזומן', transfer: 'העברה', bit: 'ביט', credit: 'אשראי', check: 'צ׳ק', other: 'אחר',
};

export function StudentDrawer({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const flags = useStudentFlags();
  const standing = useStandingOrders();
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

  // ★ כל ה-hooks לפני ה-return המוקדם. hook אחרי `if (!student) return null` משנה את
  //   מספר ה-hooks בין רינדורים → React קורס ("Rendered more hooks…") והכרטיס לא נפתח.
  const progressQ = useInstallmentProgress(student?.id ?? null);
  const { profile } = useAuth();
  const deleteStudent = useDeleteStudent();
  const cancelEnrollment = useCancelEnrollment();
  const nameHistory = useStudentNameHistory(student?.id ?? null);
  const discountHistory = useStudentDiscountHistory(student?.id ?? null);
  const [discounting, setDiscounting] = useState(false);
  const [discounted, setDiscounted] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamed] = useState<string | null>(null);
  const voidHistory = usePaymentVoidHistory(student?.id ?? null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voided, setVoided] = useState<string | null>(null);
  const [overriding, setOverriding] = useState(false);
  const [overrideDone, setOverrideDone] = useState<string | null>(null);
  useEffect(() => { setRenaming(false); setRenamed(null); setDiscounting(false); setDiscounted(null); setVoiding(null); setVoided(null); setOverriding(false); setOverrideDone(null); cancelEnrollment.reset(); }, [student?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!student) return null;

  const due = Number(student.due ?? 0);
  const inst = progressQ.data ?? null;
  const trialEnd = student.trial_started_on ? new Date(new Date(student.trial_started_on).getTime() + 30 * 86400_000) : null;
  const inTrial = Boolean(trialEnd && trialEnd >= new Date(new Date().toDateString()) && !student.cancelled_at);
  const paid = Number(student.paid ?? 0);
  const balance = Number(student.balance ?? 0);
  const progress = due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0;
  // עמודות של view מדווחות תמיד כ-nullable, גם כשהעמודה שמתחת NOT NULL.
  const status = student.status ?? 'active';
  // ממתינה לחיוב הראשון בכרטיס → "קישור הרשמה חדש" (לא קישור תשלום רגיל).
  const flag = student.id ? flags.data?.get(student.id) : undefined;
  const track = flag?.payment_track ?? null;
  const firstCharge = awaitsFirstCharge(status, track?.method, flag?.external_payment);

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
          <div className="min-w-0 flex-1">
            {renaming && student.id ? (
              <RenameForm id={student.id} fullName={student.full_name ?? ''}
                onDone={(msg) => { setRenaming(false); setRenamed(msg); }} onCancel={() => setRenaming(false)} />
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="font-display text-xl">{student.full_name}</h2>
                {(profile?.role === 'owner' || profile?.role === 'branch_manager') && (
                  <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => { setRenamed(null); setRenaming(true); }}
                    aria-label="עריכת שם התלמידה">✎ עריכת שם</button>
                )}
              </div>
            )}
            <p className="mt-0.5 text-sm text-soft">
              {student.branch_name}
              {student.grade ? ` · כיתה ${student.grade}` : ''}
            </p>
            {renamed && <p className="mt-1 text-xs text-ok" role="status">{renamed}</p>}
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
            {cancelEnrollment.data && <p className="mt-2 text-xs text-ok" role="status">ההרשמה בוטלה. זיכוי {formatILS(cancelEnrollment.data.refund)}.</p>}
            {overrideDone && <p className="mt-2 text-xs text-ok" role="status" data-testid="override-result">{overrideDone}</p>}
            {profile?.role === 'owner' && student.trial_started_on && !student.cancelled_at && student.id && (
              <div className="mt-2">
                <button type="button" className="btn-ghost w-full text-bad" disabled={!inTrial || cancelEnrollment.isPending}
                  title={inTrial ? 'ביטול בתוך חודש הניסיון — זיכוי מדמי הרישום לפי התקנון' : 'חודש הניסיון הסתיים. לפי התקנון, אחרי חודש הניסיון לא ניתן לבטל.'}
                  onClick={() => { if (window.confirm(`לבטל את ההרשמה של ${student.full_name}? תירשם הפסקה וזיכוי מדמי הרישום לפי התקנון.`)) void cancelEnrollment.mutateAsync(student.id as string); }}>
                  {cancelEnrollment.isPending ? 'מבטלת…' : 'ביטול הרשמה'}
                </button>
                {!inTrial && <p className="mt-1 text-xs text-soft">חודש הניסיון הסתיים ב-{trialEnd ? formatDate(trialEnd.toISOString().slice(0, 10)) : ''}. לפי התקנון, אחרי חודש הניסיון לא ניתן לבטל.</p>}
                {!inTrial && (overriding
                  ? <CancelOverrideForm studentId={student.id} name={student.full_name ?? ''} paid={paid} onCancel={() => setOverriding(false)}
                      onDone={(msg) => { setOverriding(false); setOverrideDone(msg); }} />
                  : <button type="button" className="mt-1 text-xs text-bad underline" onClick={() => setOverriding(true)}>ביטול בכל זאת (חריג לתקנון)</button>)}
                {cancelEnrollment.error != null && <p className="mt-1 text-xs text-bad" role="alert">{humanError(cancelEnrollment.error)}</p>}
              </div>
            )}
            {profile?.role === 'owner' && student.id && (
              <div className="mt-2">
                <button type="button" className="btn-ghost w-full text-bad" disabled={deleteStudent.isPending}
                  onClick={() => {
                    if (!window.confirm(`למחוק את ${student.full_name}?\n\nהכרטיס יוסתר מהרשימות. התשלומים שנרשמו נשארים בדוחות, והנוכחות נשמרת. קישורי תשלום פתוחים ותזכורות מתוזמנות יבוטלו.\nאפשר לשחזר ממסך התלמידות ("כולל מחוקות").`)) return;
                    void deleteStudent.mutateAsync(student.id as string).then(onClose, () => undefined);
                  }}>
                  {deleteStudent.isPending ? 'מוחקת…' : 'מחיקת תלמידה'}
                </button>
                {deleteStudent.error != null && <p className="mt-1 text-xs text-bad" role="alert">{humanError(deleteStudent.error)}</p>}
              </div>
            )}
            {Number(student.discount ?? 0) > 0 && (
              <p className="mt-2 text-xs text-soft" data-testid="student-discount">
                הנחה {formatILS(student.discount)}
                {student.discount_reason ? ` · ${student.discount_reason}` : ''}
              </p>
            )}
            {discounted && <p className="mt-1 text-xs text-ok" role="status">{discounted}</p>}
            {profile?.role === 'owner' && student.id && (discounting
              ? <DiscountForm studentId={student.id} current={Number(student.discount ?? 0)} currentReason={student.discount_reason ?? ''}
                  onDone={(msg) => { setDiscounting(false); setDiscounted(msg); }} onCancel={() => setDiscounting(false)} />
              : <button type="button" className="btn-ghost mt-2 w-full" onClick={() => { setDiscounted(null); setDiscounting(true); }}>✎ הנחה</button>)}

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
                {student.id && (firstCharge
                  ? <RenewEnrollmentLinkButton studentId={student.id} standing={track?.method === 'standing_order'} hasPhone={Boolean(student.parent_phone)} />
                  : <PaymentLinkButton studentId={student.id} balance={balance} hasPhone={Boolean(student.parent_phone)} />)}
              </>
            )}

            {payments.isLoading ? (
              <p className="mt-3 text-sm text-soft">טוען תשלומים…</p>
            ) : (payments.data?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-soft">טרם נרשמו תשלומים.</p>
            ) : (
              <ul className="mt-3 divide-y divide-rule border-t border-rule" aria-label="תשלומים">
                {(payments.data ?? []).map((p) => {
                  const refund = p.source === 'refund';
                  const refunded = (payments.data ?? []).some((r) => r.refund_of === p.id);
                  const canVoid = profile?.role === 'owner' && !refund && !refunded && Number(p.amount) > 0;
                  return (
                    <li key={p.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {formatDate(p.paid_on)}
                          <span className="text-soft"> · {METHOD_LABEL[p.method] ?? p.method}</span>
                          {refund && <span className="text-bad"> · החזר</span>}
                          {refunded && <span className="text-soft"> · הוחזר</span>}
                          {p.covers_note && <span className="text-soft"> · {p.covers_note}</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={`tabular-nums ${refund ? 'text-bad' : ''}`}>{formatILS(p.amount)}</span>
                          {canVoid && voiding !== p.id && (
                            <button type="button" className="text-xs text-bad hover:underline" onClick={() => { setVoided(null); setVoiding(p.id); }}>ביטול</button>
                          )}
                        </span>
                      </div>
                      {refund && p.void_reason && <p className="text-xs text-soft">{p.void_reason}</p>}
                      {voiding === p.id && (
                        <VoidPaymentForm payment={p} onDone={(msg) => { setVoiding(null); setVoided(msg); }} onCancel={() => setVoiding(null)} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {voided && <p className="mt-2 text-xs text-ok" role="status" data-testid="void-result">{voided}</p>}
            {(voidHistory.data ?? []).length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-rule pt-1 text-xs text-soft" aria-label="תשלומים שבוטלו">
                {(voidHistory.data ?? []).map((h) => (
                  <li key={`${h.at}-${h.amount}`}>
                    {formatDateTime(h.at)} · {h.by_name}: {h.kind === 'refund' ? 'הוחזר להורה' : 'בוטל (נרשם בטעות)'} — {formatILS(h.amount)} מ-{formatDate(h.paid_on)}{h.reason ? ` · ${h.reason}` : ''}
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

          {(() => {
            const orders = (standing.data ?? []).filter((o) => o.student_id === student.id);
            if (orders.length === 0) return null;
            return (
              <Section title="הוראת קבע">
                <div className="space-y-3">{orders.map((o) => <StandingOrderPanel key={o.id} order={o} />)}</div>
              </Section>
            );
          })()}

          <Section title="פרטי קשר">
            <dl className="space-y-1 text-sm">
              <Row label="הורה" value={student.parent_name} />
              <Row label="טלפון" value={formatPhone(student.parent_phone)} ltr />
              <div className="flex gap-2">
                <dt className="text-soft">מייל:</dt>
                <dd dir="ltr">{student.email ? <a href={`mailto:${student.email}`} className="text-plum hover:underline">{student.email}</a> : '—'}</dd>
              </div>
              <Row label="הצטרפה" value={formatDate(student.joined_on)} />
              {student.stopped_on && <Row label="הפסיקה" value={formatDate(student.stopped_on)} />}
              {student.stop_reason && <Row label="סיבה" value={student.stop_reason} />}
              <Row label="אישור צילום" value={student.photo_consent ? 'יש' : 'אין'} />
              {(() => {
                const f = student.id ? flags.data?.get(student.id) : undefined;
                if (!f) return null;
                return (
                  <>
                    {f.external_payment && <div><StudentTags external /> <span className="text-xs text-soft">התשלום נגבה מחוץ למערכת. אין קישור תשלום ואין תזכורות חוב.</span></div>}
                    {f.payment_track?.label && <Row label="מסלול תשלום" value={f.payment_track.label} />}
                    {f.whatsapp_opt_in === false && <div><StudentTags whatsapp={false} /> <span className="text-xs text-soft">ענתה שאינה מקבלת וואטסאפ — תזכורות אליה לא נשלחות.</span></div>}
                    {f.photo_consent_text && <details className="text-xs text-soft"><summary className="cursor-pointer">נוסח אישור הצילום שאושר</summary><p className="mt-1 whitespace-pre-wrap">{f.photo_consent_text}</p></details>}
                    {f.terms_text && <details className="text-xs text-soft"><summary className="cursor-pointer">התקנון שאושר</summary><p className="mt-1 whitespace-pre-wrap">{f.terms_text}</p></details>}
                  </>
                );
              })()}
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

          {(discountHistory.data ?? []).length > 0 && (
            <Section title="היסטוריית הנחות">
              <ul className="space-y-1 text-xs text-soft" aria-label="היסטוריית ההנחות">
                {(discountHistory.data ?? []).map((h, i) => (
                  <li key={i}>{formatDateTime(h.changed_at)} · {h.changed_by}: {formatILS(h.from_amount)} ← {formatILS(h.to_amount)}{h.reason ? ` · ${h.reason}` : ''}</li>
                ))}
              </ul>
            </Section>
          )}

          {(nameHistory.data ?? []).length > 0 && (
            <Section title="שינויי שם">
              <ul className="space-y-1 text-xs text-soft" aria-label="היסטוריית השם">
                {(nameHistory.data ?? []).map((h, i) => (
                  <li key={i}>{formatDateTime(h.changed_at)} · {h.changed_by}: מ-„{h.from_name}” ל-„{h.to_name}”</li>
                ))}
              </ul>
            </Section>
          )}

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

/**
 * עריכת השם בכרטיס: שם פרטי ושם משפחה. השמירה במסד (rpc_rename_student) — שם גם הבדיקות
 * (אותיות בלבד, אין כפילות בסניף) וההרשאה. הודעה אחרי השמירה: מה התעדכן.
 */
function RenameForm({ id, fullName, onDone, onCancel }: { id: string; fullName: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [first, setFirst] = useState(fullName.split(' ')[0] ?? '');
  const [last, setLast] = useState(fullName.split(' ').slice(1).join(' '));
  const rename = useRenameStudent();
  const f = first.trim(), l = last.trim();
  const local = !f ? 'יש למלא שם פרטי' : !NAME_RE.test(f) || (l && !NAME_RE.test(l)) ? 'אותיות בלבד' : null;
  const same = `${f} ${l}`.trim() === fullName.trim();
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      if (local || same) return;
      rename.mutate({ id, first: f, last: l }, {
        onSuccess: (r) => {
          const msgs = r.reminders + r.emails;
          onDone(`✓ השם עודכן מ-„${r.from}” ל-„${r.full_name}” בכל המסכים${msgs ? `, וגם ב-${msgs} הודעות שעוד לא יצאו` : ''}.`);
        },
      });
    }}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">שם פרטי
          <input className="field mt-0.5" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
        </label>
        <label className="block text-xs">שם משפחה
          <input className="field mt-0.5" value={last} onChange={(e) => setLast(e.target.value)} />
        </label>
      </div>
      {(local || rename.error != null) && <p className="text-xs text-bad" role="alert">{local ?? humanError(rename.error)}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary px-3 py-1 text-xs" disabled={Boolean(local) || same || rename.isPending}>
          {rename.isPending ? 'שומרת…' : 'שמירה'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={rename.isPending} onClick={onCancel}>ביטול</button>
      </div>
    </form>
  );
}

/**
 * הנחה (הבעלים): בשקלים או באחוזים משכר הלימוד, וסיבה. המסד מחשב מה ישתנה — חוב, קישור פתוח,
 * הוראת קבע — ומציג לפני השמירה. בהוראת קבע פעילה הסכום מתעדכן ב-SUMIT לפני שנשמר אצלנו.
 */
function DiscountForm({ studentId, current, currentReason, onDone, onCancel }:
  { studentId: string; current: number; currentReason: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'ils' | 'percent'>('ils');
  const [raw, setRaw] = useState(current > 0 ? String(current) : '');
  const [reason, setReason] = useState(currentReason);
  const [value, setValue] = useState<number | null>(current > 0 ? current : null);
  // החישוב מהמסד — רק אחרי הפסקה קצרה בהקלדה.
  useEffect(() => {
    const t = window.setTimeout(() => { const n = Number(raw); setValue(raw.trim() !== '' && Number.isFinite(n) ? n : null); }, 350);
    return () => window.clearTimeout(t);
  }, [raw]);
  const preview = useDiscountPreview(studentId, kind, value);
  const save = useApplyDiscount();
  const plan = preview.data;
  const ready = Boolean(plan?.ok) && !preview.isFetching && raw.trim() !== '' && Number(raw) === value;
  return (
    <div className="mt-2 space-y-2 rounded-field border border-rule p-3 text-sm" data-testid="discount-form">
      <div className="flex items-end gap-2">
        <label className="block flex-1 text-xs">הנחה
          <input className="field mt-0.5" inputMode="numeric" value={raw} onChange={(e) => { save.reset(); setRaw(e.target.value); }} aria-label="סכום ההנחה" />
        </label>
        <div className="flex overflow-hidden rounded-btn border border-rule text-xs" role="group" aria-label="סוג ההנחה">
          {(['ils', 'percent'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} className={`px-3 py-2 ${kind === k ? 'bg-plum text-white' : ''}`}
              onClick={() => { save.reset(); setKind(k); }}>{k === 'ils' ? '₪' : '%'}</button>
          ))}
        </div>
      </div>
      <label className="block text-xs">סיבה (חובה)
        <input className="field mt-0.5" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: אחות שנייה" aria-label="סיבת ההנחה" />
      </label>
      {raw.trim() !== '' && preview.isFetching && <p className="text-xs text-soft">מחשבת…</p>}
      {preview.error != null && <p className="text-xs text-bad" role="alert">{humanError(preview.error)}</p>}
      {plan && !plan.ok && <p className="text-xs text-bad" role="alert">{plan.error}</p>}
      {plan?.ok && (
        <ul className="space-y-0.5 text-xs" data-testid="discount-plan">
          {plan.lines.map((l, i) => <li key={i} className={i === 0 ? 'font-medium' : ''}>{l}</li>)}
          {plan.stage === 'standing' && <li className="text-soft">הסכום החודשי יתעדכן ב-SUMIT לפני שההנחה נשמרת.</li>}
        </ul>
      )}
      {save.error != null && <p className="text-xs text-bad" role="alert">{humanError(save.error)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={!ready || !reason.trim() || save.isPending}
          onClick={() => {
            if (!plan?.ok || value === null) return;
            save.mutate({ student: studentId, kind, value, reason: reason.trim(), expected: plan.discount_after },
              { onSuccess: (p) => onDone(`✓ ההנחה נשמרה: ${p.lines[0] ?? ''}`) });
          }}>
          {save.isPending ? 'שומרת…' : 'שמירת ההנחה'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={save.isPending} onClick={onCancel}>ביטול</button>
      </div>
    </div>
  );
}

/**
 * ביטול תשלום (בעלים): "נרשם בטעות" — נמחק מהחוב; "הוחזר להורה" — שורת החזר. סיבה חובה. את הכסף עצמו
 * מחזירים ב-SUMIT — כאן נרשם מה שקרה, והחוב חוזר כאילו לא שולם.
 */
function VoidPaymentForm({ payment, onDone, onCancel }: { payment: { id: string; amount: number; paid_on: string; source: string | null }; onDone: (msg: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<VoidKind | null>(null);
  const [reason, setReason] = useState('');
  const save = useVoidPayment();
  const amount = formatILS(payment.amount);
  return (
    <div className="mt-2 space-y-2 rounded-field border border-rule p-2" data-testid="void-form">
      <fieldset className="space-y-1 text-xs">
        <legend className="mb-1 font-medium">ביטול התשלום של {amount} מ-{formatDate(payment.paid_on)}</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name={`void-${payment.id}`} checked={kind === 'mistake'} onChange={() => setKind('mistake')} />
          <span><b>נרשם בטעות</b> — התשלום יימחק, והחוב יחזור כאילו לא שולם.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name={`void-${payment.id}`} checked={kind === 'refund'} onChange={() => setKind('refund')} />
          <span><b>הוחזר להורה</b> — תירשם שורת החזר של {amount}; התשלום וההחזר יישארו בהיסטוריה.</span>
        </label>
      </fieldset>
      <label className="block text-xs">סיבה
        <input className="field mt-1 py-1 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="סיבת הביטול" />
      </label>
      {payment.source === 'sumit' && <p className="text-xs text-warn">התשלום הגיע מ-SUMIT: את הכסף עצמו מחזירים ב-SUMIT (זיכוי לעסקה). כאן רק נרשם.</p>}
      {save.error != null && <p className="text-xs text-bad" role="alert">{humanError(save.error)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={!kind || !reason.trim() || save.isPending}
          onClick={() => {
            if (!kind || !reason.trim()) return;
            if (!window.confirm(kind === 'refund' ? `לרשום החזר של ${amount}?` : `למחוק את התשלום של ${amount} (נרשם בטעות)?`)) return;
            save.mutate({ paymentId: payment.id, kind, reason: reason.trim() }, {
              onSuccess: (r) => onDone([
                kind === 'refund' ? `✓ נרשם החזר של ${amount}.` : `✓ התשלום של ${amount} נמחק.`,
                `החוב עכשיו ${formatILS(r.balance)}.`,
                r.pending ? 'התלמידה חזרה ל"ממתינה" — אפשר לשלוח לה "קישור הרשמה חדש".' : '',
                r.from_sumit ? 'את הכסף עצמו מחזירים ב-SUMIT.' : '',
                r.standing_active ? '⚠ לתלמידה יש הוראת קבע פעילה ב-SUMIT — הביטול כאן לא עוצר אותה.' : '',
              ].filter(Boolean).join(' ')),
            });
          }}>
          {save.isPending ? 'מבטלת…' : 'ביטול התשלום'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={save.isPending} onClick={onCancel}>חזרה</button>
      </div>
    </div>
  );
}

/**
 * ביטול הרשמה חריג לתקנון (הבעלים): אחרי חודש הניסיון. סכום ההחזר — החלטה של הבעלים (0 עד מה ששולם),
 * סיבה חובה, ונרשם ביומן כחריג. את הכסף עצמו מחזירים ב-SUMIT.
 */
function CancelOverrideForm({ studentId, name, paid, onCancel, onDone }: { studentId: string; name: string; paid: number; onCancel: () => void; onDone: (msg: string) => void }) {
  const [refund, setRefund] = useState('0');
  const [reason, setReason] = useState('');
  const save = useCancelEnrollmentOverride();
  const n = Number(refund);
  const invalid = !refund.trim() || !Number.isFinite(n) ? 'יש לכתוב סכום (אפשר 0)' : n < 0 ? 'לא שלילי' : n > paid ? `יותר ממה ששולם (${formatILS(paid)})` : null;
  return (
    <div className="mt-2 space-y-2 rounded-field border border-bad/40 p-2 text-xs" data-testid="cancel-override">
      <p className="font-medium text-bad">ביטול הרשמה חריג לתקנון</p>
      <p className="text-soft">לפי התקנון אחרי חודש הניסיון אין ביטול. זה חריג, ויירשם ביומן עם הסיבה. התלמידה תעבור ל"הפסיקה", וקישורים ותזכורות פתוחים יבוטלו.</p>
      <label className="block">כמה להחזיר להורה (₪) — שולם {formatILS(paid)}
        <input className="field mt-1 w-32 py-1 text-sm" type="number" inputMode="decimal" min={0} max={paid} step="any" dir="ltr"
          aria-label="סכום ההחזר" value={refund} onChange={(e) => setRefund(e.target.value)} />
      </label>
      {invalid && refund !== '' && <p className="text-bad">{invalid}</p>}
      <label className="block">סיבה
        <input className="field mt-1 py-1 text-sm" aria-label="סיבת הביטול החריג" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {save.error != null && <p className="text-bad" role="alert">{humanError(save.error)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary bg-bad px-3 py-1 text-xs" disabled={Boolean(invalid) || !reason.trim() || save.isPending}
          onClick={() => {
            if (invalid || !reason.trim()) return;
            if (!window.confirm(`לבטל את ההרשמה של ${name} (חריג לתקנון)${n > 0 ? `, עם החזר של ${formatILS(n)}` : ', בלי החזר'}?`)) return;
            // ★ אחרי הביטול הכרטיס מתרענן והקטע של "ביטול הרשמה" נעלם — ההודעה מוצגת מחוץ לו.
            save.mutate({ studentId, refund: n, reason: reason.trim() }, {
              onSuccess: (r) => onDone(`✓ ההרשמה בוטלה (חריג לתקנון). ${r.refund > 0 ? `נרשם החזר של ${formatILS(r.refund)}.` : 'בלי החזר.'}`
                + (r.refund > 0 && r.from_sumit ? ' את הכסף עצמו מחזירים ב-SUMIT (זיכוי לעסקה).' : '')),
            });
          }}>
          {save.isPending ? 'מבטלת…' : 'ביטול ההרשמה'}
        </button>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={save.isPending} onClick={onCancel}>חזרה</button>
      </div>
    </div>
  );
}
