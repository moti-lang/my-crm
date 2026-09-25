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
  branch_id: string; mailing_consent: boolean; terms_accepted: boolean;
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
  if (!f.branch_id) e.branch_id = 'יש לבחור סניף';
  if (!f.terms_accepted) e.terms_accepted = 'יש לקרוא ולאשר את התקנון';
  return e;
}

/** תיאור מבנה התשלום להורה, מהמספרים שבהגדרות. */
export function describePlan(p: { annual_total: number; registration_fee: number; installments: number; installment_amount: number; first_charge: number }): string {
  const rest = p.installments - 1;
  return `העלות השנתית ${p.annual_total} ₪. החיוב הראשון ${p.first_charge} ₪ (${p.registration_fee} ₪ דמי רישום + ${p.installment_amount} ₪ תשלום ראשון), ואחריו ${rest} תשלומים חודשיים של ${p.installment_amount} ₪.`;
}
