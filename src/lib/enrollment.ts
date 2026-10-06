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
  /** השאלות שמוצגות לפי הגדרות הסניף. '' = טרם נענתה. */
  whatsapp: '' | 'yes' | 'no'; photo: '' | 'yes' | 'no'; track: string;
};

/** אילו שאלות הסניף מציג. שאלה מוסתרת אינה חובה ואינה נשלחת. */
export type EnrollQuestions = { whatsapp: boolean; photo: boolean; track: boolean };

/** הודעה לכל שדה פגום, בעברית. ריק = תקין. */
export function validateEnroll(f: EnrollForm, q: EnrollQuestions = { whatsapp: false, photo: false, track: false }): Partial<Record<keyof EnrollForm, string>> {
  const e: Partial<Record<keyof EnrollForm, string>> = {};
  if (!f.first_name.trim()) e.first_name = 'יש למלא שם פרטי';
  else if (!NAME_RE.test(f.first_name)) e.first_name = 'אותיות בלבד';
  if (!f.last_name.trim()) e.last_name = 'יש למלא שם משפחה';
  else if (!NAME_RE.test(f.last_name)) e.last_name = 'אותיות בלבד';
  if (!f.grade.trim()) e.grade = 'יש למלא כיתה';
  if (!f.school.trim()) e.school = 'יש למלא בית ספר';
  if (!isIsraeliMobile(f.phone)) e.phone = 'נייד ישראלי, למשל 052-1234567';
  if (!isEmail(f.email)) e.email = 'כתובת מייל תקינה';
  if (q.whatsapp && !f.whatsapp) e.whatsapp = 'יש לבחור כן או לא';
  if (q.photo && !f.photo) e.photo = 'יש לבחור כן או לא';
  if (q.track && !f.track) e.track = 'יש לבחור אופן תשלום';
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

/** מסלול תשלום כפי שהבעלים מגדירה אותו. הסכומים מחושבים, לא מוקלדים. */
export type TrackMethod = 'cash' | 'card_once' | 'standing_order';
export type TrackDef = { key: string; label: string; method: TrackMethod; installments: number };
/** מסלול מחושב — אותו כלל כמו f_plan_tracks במסד. */
export type Track = TrackDef & { installment_amount: number; first_installment: number; first_charge: number; total: number };

export const METHOD_LABEL: Record<TrackMethod, string> = {
  cash: 'מזומן', card_once: 'אשראי בתשלום אחד', standing_order: 'הוראת קבע באשראי',
};

/**
 * ★ הכלל: שכר הלימוד (סך − דמי רישום) מחולק שווה, עגול לשקל; כשלא יוצא
 * עגול — התשלום הראשון סופג את ההפרש. 1,100 ב-8: 141 ואז 7 × 137.
 */
export function computeTrack(def: TrackDef, annualTotal: number, registrationFee: number): Track {
  const tuition = annualTotal - registrationFee;
  const n = def.method === 'standing_order' ? Math.max(1, Math.trunc(def.installments)) : 1;
  const each = Math.floor(tuition / n);
  const first = tuition - each * (n - 1);
  const first_charge = def.method === 'cash' ? 0 : def.method === 'card_once' ? annualTotal : registrationFee + first;
  return { ...def, installments: n, installment_amount: each, first_installment: first, first_charge, total: annualTotal };
}

/** ההסבר להורה, במילים. */
export function describeTrack(t: Track): string {
  if (t.method === 'cash') return `${t.total} ₪ במזומן, משולמים בסניף.`;
  if (t.method === 'card_once') return `${t.total} ₪ בכרטיס אשראי, בתשלום אחד עכשיו.`;
  const rest = t.installments - 1;
  return `${t.first_charge} ₪ עכשיו (דמי רישום + תשלום ראשון), ואחריו ${rest} תשלומים חודשיים של ${t.installment_amount} ₪.`;
}

/** מבנה התשלום של סניף (או ברירת המחדל). אותם כללים כמו f_plan_check במסד. */
export type PlanInput = {
  annual_total?: number; registration_fee?: number; trial_days?: number; cancel_refund?: number;
  registration_fee_purpose?: string; tracks?: TrackDef[];
};
export function checkPlan(p: PlanInput): { ok: boolean; message: string; tracks: Track[] } {
  const total = Number(p.annual_total), fee = Number(p.registration_fee);
  const defs = p.tracks ?? [];
  if (!Number.isFinite(total) || !Number.isFinite(fee)) return { ok: false, message: 'יש למלא שכר לימוד שנתי ודמי רישום', tracks: [] };
  if (fee < 0 || total <= fee) return { ok: false, message: 'שכר הלימוד השנתי חייב להיות גדול מדמי הרישום', tracks: [] };
  if (defs.length === 0) return { ok: false, message: 'צריך לפחות מסלול תשלום אחד', tracks: [] };
  if (defs.some((d) => !d.label.trim())) return { ok: false, message: 'לכל מסלול צריך שם', tracks: [] };
  if (defs.some((d) => d.method === 'standing_order' && (!Number.isInteger(d.installments) || d.installments < 1 || d.installments > 36))) {
    return { ok: false, message: 'מספר תשלומים בהוראת קבע: בין 1 ל-36', tracks: [] };
  }
  const tracks = defs.map((d) => computeTrack(d, total, fee));
  return { ok: true, message: `✓ כל מסלול מסתכם ל-${total} ₪ (${fee} דמי רישום + ${total - fee} שכר לימוד)`, tracks };
}
