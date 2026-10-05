/**
 * אימות דף ההרשמה בצד הלקוח — אותם כללים כמו במסד (rpc_enroll), כדי
 * שההורה תקבל הודעה מיד. המסד הוא המחליט; זה רק נוחות.
 */
export const NAME_RE = /^[֐-׿A-Za-z'"\-\s]+$/;

export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return /^0\d{9}$/.test(d) ? `972${d.slice(1)}` : d;
}
export function isIsraeliMobile(raw: string): boolean {
  return /^9725\d{8}$/.test(normalizePhone(raw));
}
export function isEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
}

export type EnrollForm = {
  first_name: string; last_name: string; grade: string; school: string; phone: string; email: string;
  mailing_consent: boolean; terms_accepted: boolean;
};

/** הודעה לכל שדה פגום, בעברית. ריק = תקין. */
export function validateEnroll(f: EnrollForm): Partial<Record<keyof EnrollForm, string>> {
  const e: Partial<Record<keyof EnrollForm, string>> = {};
  if (!f.first_name.trim()) e.first_name = 'יש למלא שם פרטי';
  else if (!NAME_RE.test(f.first_name)) e.first_name = 'אותיות בלבד';
  if (!f.last_name.trim()) e.last_name = 'יש למלא שם משפחה';
  else if (!NAME_RE.test(f.last_name)) e.last_name = 'אותיות בלבד';
  if (!f.grade.trim()) e.grade = 'יש למלא כיתה';
  if (!f.school.trim()) e.school = 'יש למלא בית ספר';
  if (!isIsraeliMobile(f.phone)) e.phone = 'נייד ישראלי, למשל 052-1234567';
  if (!isEmail(f.email)) e.email = 'כתובת מייל תקינה';
  if (!f.terms_accepted) e.terms_accepted = 'יש לקרוא ולאשר את התקנון';
  return e;
}

/** תיאור מבנה התשלום להורה, מהמספרים שבהגדרות. */
export function describePlan(p: { annual_total: number; registration_fee: number; installments: number; installment_amount: number; first_charge: number }): string {
  const rest = p.installments - 1;
  return `העלות השנתית ${p.annual_total} ₪. החיוב הראשון ${p.first_charge} ₪ (${p.registration_fee} ₪ דמי רישום + ${p.installment_amount} ₪ תשלום ראשון), ואחריו ${rest} תשלומים חודשיים של ${p.installment_amount} ₪.`;
}

/**
 * הסניף נקבע מהקישור (/enroll/<טוקן>), לא מבחירה של ההורה. בלי טוקן
 * (/enroll) המסד מוביל לסניף הפעיל היחיד, ואם יש כמה — מבקש את הקישור.
 */
export function enrollTokenFromPath(pathname: string): string {
  const m = /^\/enroll\/([0-9a-f]{16,64})\/?$/i.exec(pathname);
  return m ? m[1]!.toLowerCase() : '';
}

/** מבנה התשלום של סניף (או ברירת המחדל). אותם כללים כמו f_plan_check במסד. */
export type PlanInput = {
  annual_total?: number; registration_fee?: number; installments?: number; installment_amount?: number;
  first_charge?: number; trial_days?: number; cancel_refund?: number; registration_fee_purpose?: string;
};
export function checkPlan(p: PlanInput): { ok: boolean; message: string; first_charge: number } {
  const total = Number(p.annual_total), fee = Number(p.registration_fee), n = Number(p.installments), each = Number(p.installment_amount);
  const first = fee + each;
  if (![total, fee, n, each].every(Number.isFinite) || n < 1) return { ok: false, message: 'יש למלא שכר לימוד שנתי, דמי רישום, מספר תשלומים וסכום לתשלום', first_charge: first };
  if (fee < 0 || each <= 0) return { ok: false, message: 'דמי רישום וסכום לתשלום חייבים להיות חיוביים', first_charge: first };
  const sum = fee + n * each;
  if (sum !== total) return { ok: false, message: `✗ המבנה לא מסתכם: ${fee} + ${n} × ${each} = ${sum}, ולא ${total}. ההרשמה לסניף תסרב עד שזה יתוקן.`, first_charge: first };
  return { ok: true, message: `✓ ${fee} + ${n} × ${each} = ${total}. החיוב הראשון: ${first} (דמי רישום + תשלום אחד)`, first_charge: first };
}
