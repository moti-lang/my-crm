/**
 * ליבת ייבוא התלמידות — טהורה, בלי DOM ובלי רשת.
 *
 * שלושה שלבים, כל אחד פונקציה: זיהוי עמודות (autoMap), פרסור ואימות
 * (parseRows), ותבנית להורדה (buildTemplateSheet). הבדיקה
 * students-import.test.mjs מריצה 50 שורות מעורבות דרך שלושתם.
 *
 * הכלל: שורה פגומה לא נעצרת ולא נבלעת — היא מקבלת שגיאה בעברית,
 * והשורות התקינות ממשיכות. הדוח הוא חלק מהתוצאה, לא לוג.
 */
import { normalizePhone } from './format';
import type { CellValue, Column } from './export-core';

export type Field =
  | 'full_name' | 'branch' | 'grade' | 'group_name' | 'parent_name' | 'parent_phone' | 'alt_phone'
  | 'address' | 'email' | 'status' | 'joined_on' | 'birth_date' | 'tuition_total' | 'discount'
  | 'discount_reason' | 'installments' | 'photo_consent' | 'notes';

export const FIELD_LABEL: Record<Field, string> = {
  full_name: 'שם התלמידה', branch: 'סניף', grade: 'כיתה', group_name: 'קבוצה', parent_name: 'שם ההורה',
  parent_phone: 'טלפון ההורה', alt_phone: 'טלפון נוסף', address: 'כתובת', email: 'אימייל', status: 'סטטוס',
  joined_on: 'תאריך הצטרפות', birth_date: 'תאריך לידה', tuition_total: 'שכר לימוד', discount: 'הנחה',
  discount_reason: 'סיבת ההנחה', installments: 'מספר תשלומים', photo_consent: 'אישור צילום', notes: 'הערות',
};

export const REQUIRED: Field[] = ['full_name', 'branch'];

/** כותרות חלופיות שמזוהות אוטומטית. הכל אחרי נרמול (בלי רווחים וניקוד). */
const SYNONYMS: Record<Field, string[]> = {
  full_name: ['שם', 'שםהתלמידה', 'תלמידה', 'שםמלא', 'שםהבת', 'name', 'fullname', 'student'],
  branch: ['סניף', 'סניפים', 'עיר', 'branch'],
  grade: ['כיתה', 'כתה', 'grade'],
  group_name: ['קבוצה', 'group'],
  parent_name: ['הורה', 'שםההורה', 'שםהאם', 'אמא', 'אם', 'parent', 'parentname'],
  parent_phone: ['טלפון', 'טלפוןההורה', 'נייד', 'טלפוןאמא', 'phone', 'parentphone', 'mobile'],
  alt_phone: ['טלפוןנוסף', 'טלפון2', 'טלפוןאבא', 'נייד2', 'altphone', 'phone2'],
  address: ['כתובת', 'address'],
  email: ['אימייל', 'מייל', 'דואל', 'email'],
  status: ['סטטוס', 'מצב', 'status'],
  joined_on: ['תאריךהצטרפות', 'הצטרפה', 'הצטרפות', 'תאריךרישום', 'joined', 'joinedon'],
  birth_date: ['תאריךלידה', 'לידה', 'birthdate', 'dob'],
  tuition_total: ['שכרלימוד', 'מחיר', 'עלות', 'סכום', 'tuition', 'price'],
  discount: ['הנחה', 'discount'],
  discount_reason: ['סיבתההנחה', 'סיבתהנחה', 'discountreason'],
  installments: ['תשלומים', 'מספרתשלומים', 'installments'],
  photo_consent: ['אישורצילום', 'צילום', 'אישור', 'photoconsent', 'consent'],
  notes: ['הערות', 'הערה', 'notes'],
};

const norm = (s: string) => s.toLowerCase().replace(/[\s"'״׳_\-:.()]/g, '').replace(/[֑-ׇ]/g, '');

/** מיפוי אוטומטי: כותרת → שדה, או null כשלא זוהתה. שדה מזוהה פעם אחת בלבד. */
export function autoMap(headers: (CellValue | undefined)[]): (Field | null)[] {
  const used = new Set<Field>();
  return headers.map((h) => {
    const key = norm(String(h ?? ''));
    if (!key) return null;
    for (const [field, names] of Object.entries(SYNONYMS) as [Field, string[]][]) {
      if (used.has(field)) continue;
      if (names.some((n) => norm(n) === key) || norm(FIELD_LABEL[field]) === key) { used.add(field); return field; }
    }
    return null;
  });
}

export type StudentStatus = 'active' | 'pending' | 'stopped' | 'graduated';
const STATUS_WORDS: Record<string, StudentStatus> = {
  'פעילה': 'active', 'פעיל': 'active', 'active': 'active', 'לומדת': 'active',
  'ממתינה': 'pending', 'ממתין': 'pending', 'pending': 'pending', 'ליד': 'pending',
  'הפסיקה': 'stopped', 'הפסיק': 'stopped', 'עזבה': 'stopped', 'stopped': 'stopped', 'לאפעילה': 'stopped',
  'סיימה': 'graduated', 'בוגרת': 'graduated', 'graduated': 'graduated',
};

export type ImportRow = {
  full_name: string; branch_id: string; branch_name: string; grade: string | null; group_name: string | null;
  parent_name: string | null; parent_phone: string | null; alt_phone: string | null; address: string | null;
  email: string | null; status: StudentStatus; joined_on: string | null; birth_date: string | null;
  tuition_total: number; discount: number; discount_reason: string | null; installments: number;
  photo_consent: boolean; notes: string | null; source: 'import';
};

export type RowError = { line: number; field: Field | null; message: string; value?: string };
export type ParsedRow = { line: number; row: ImportRow | null; errors: RowError[]; warnings: string[]; raw: Record<Field, string> };

export type ParseContext = {
  branches: { id: string; name: string; default_tuition: number | string | null }[];
  /** תלמידות קיימות לזיהוי כפילויות: שם+סניף או טלפון */
  existing: { full_name: string; branch_id: string; parent_phone: string | null }[];
};

/** תאריך מתא: dd/MM/yyyy, yyyy-MM-dd, או מספר סידורי של אקסל. */
export function parseDate(v: CellValue | undefined): string | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return 'invalid';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return 'invalid';
}
function iso(y: number, mo: number, d: number): string | 'invalid' {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 'invalid';
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return 'invalid';
  return dt.toISOString().slice(0, 10);
}

export function parseBool(v: CellValue | undefined): boolean | 'invalid' {
  if (v === null || v === undefined || v === '') return false;
  const s = norm(String(v));
  if (['כן', 'יש', 'v', 'x', 'true', 'yes', '1', 'מאושר', 'אישרה'].includes(s)) return true;
  if (['לא', 'אין', 'false', 'no', '0', ''].includes(s)) return false;
  return 'invalid';
}

function parseMoney(v: CellValue | undefined): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₪,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

export const isIsraeliMobile = (p: string) => /^9725\d{8}$/.test(p);

/** מפרסר גיליון שלם. השורה הראשונה היא כותרות; mapping באורכה. */
export function parseRows(aoa: CellValue[][], mapping: (Field | null)[], ctx: ParseContext): ParsedRow[] {
  const byName = new Map(ctx.branches.map((b) => [norm(b.name), b]));
  const seen = new Map<string, number>();
  const existingKeys = new Set(ctx.existing.map((e) => `${norm(e.full_name)}|${e.branch_id}`));
  const existingPhones = new Set(ctx.existing.map((e) => e.parent_phone).filter(Boolean));
  const out: ParsedRow[] = [];

  for (let i = 1; i < aoa.length; i++) {
    const cells = aoa[i] ?? [];
    const line = i + 1;
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const raw = {} as Record<Field, string>;
    const get = (f: Field): CellValue | undefined => {
      const idx = mapping.indexOf(f);
      return idx === -1 ? undefined : cells[idx];
    };
    for (const f of Object.keys(FIELD_LABEL) as Field[]) raw[f] = String(get(f) ?? '').trim();

    const errors: RowError[] = [];
    const warnings: string[] = [];
    const err = (field: Field | null, message: string, value?: string) => errors.push({ line, field, message, value });

    const full_name = raw.full_name;
    if (!full_name) err('full_name', 'חסר שם');

    const branch = raw.branch ? byName.get(norm(raw.branch)) ?? null : null;
    if (!raw.branch) err('branch', 'חסר סניף');
    else if (!branch) err('branch', `סניף לא מוכר: "${raw.branch}"`, raw.branch);

    const phone = raw.parent_phone ? normalizePhone(raw.parent_phone) : null;
    if (phone && !isIsraeliMobile(phone)) err('parent_phone', `טלפון לא תקין: "${raw.parent_phone}"`, raw.parent_phone);
    const alt = raw.alt_phone ? normalizePhone(raw.alt_phone) : null;
    if (alt && !isIsraeliMobile(alt)) err('alt_phone', `טלפון נוסף לא תקין: "${raw.alt_phone}"`, raw.alt_phone);

    const email = raw.email || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('email', `אימייל לא תקין: "${email}"`, email);

    let status: StudentStatus = 'active';
    if (raw.status) {
      const s = STATUS_WORDS[norm(raw.status)];
      if (!s) err('status', `סטטוס לא מוכר: "${raw.status}" (פעילה / ממתינה / הפסיקה / סיימה)`, raw.status);
      else status = s;
    }

    const joined = parseDate(get('joined_on'));
    if (joined === 'invalid') err('joined_on', `תאריך הצטרפות לא תקין: "${raw.joined_on}"`, raw.joined_on);
    const birth = parseDate(get('birth_date'));
    if (birth === 'invalid') err('birth_date', `תאריך לידה לא תקין: "${raw.birth_date}"`, raw.birth_date);

    const tuition = parseMoney(get('tuition_total'));
    if (tuition === 'invalid') err('tuition_total', `שכר לימוד לא תקין: "${raw.tuition_total}"`, raw.tuition_total);
    const discount = parseMoney(get('discount'));
    if (discount === 'invalid') err('discount', `הנחה לא תקינה: "${raw.discount}"`, raw.discount);

    let installments = 1;
    if (raw.installments) {
      const n = Number(raw.installments);
      if (!Number.isInteger(n) || n < 1 || n > 24) err('installments', `מספר תשלומים לא תקין: "${raw.installments}"`, raw.installments);
      else installments = n;
    }
    const consent = parseBool(get('photo_consent'));
    if (consent === 'invalid') err('photo_consent', `אישור צילום: צריך "כן" או "לא" (התקבל "${raw.photo_consent}")`, raw.photo_consent);

    // כפילויות: בתוך הקובץ, ומול המסד.
    if (full_name && branch) {
      const key = `${norm(full_name)}|${branch.id}`;
      const first = seen.get(key);
      if (first !== undefined) err(null, `כפולה של שורה ${first} (אותו שם באותו סניף)`);
      else seen.set(key, line);
      if (existingKeys.has(key)) err(null, `כבר קיימת במערכת: ${full_name} ב${branch.name}`);
    }
    if (phone && existingPhones.has(phone) && !errors.some((e) => e.message.startsWith('כבר קיימת'))) {
      warnings.push('הטלפון כבר קיים אצל תלמידה אחרת (אחיות?)');
    }
    if (tuition === null && branch) warnings.push(`שכר לימוד לא צוין — נלקח מברירת המחדל של ${branch.name}`);
    if (!phone) warnings.push('אין טלפון הורה — לא יישלחו תזכורות');

    const row: ImportRow | null = errors.length === 0 && branch ? {
      full_name, branch_id: branch.id, branch_name: branch.name,
      grade: raw.grade || null, group_name: raw.group_name || null,
      parent_name: raw.parent_name || null, parent_phone: phone, alt_phone: alt,
      address: raw.address || null, email, status,
      joined_on: joined === 'invalid' ? null : joined, birth_date: birth === 'invalid' ? null : birth,
      tuition_total: tuition === null || tuition === 'invalid' ? Number(branch.default_tuition ?? 0) : tuition,
      discount: discount === null || discount === 'invalid' ? 0 : discount,
      discount_reason: raw.discount_reason || null, installments,
      photo_consent: consent === true, notes: raw.notes || null, source: 'import',
    } : null;

    out.push({ line, row, errors, warnings, raw });
  }
  return out;
}

/** עמודות התבנית להורדה — הכותרות שהמיפוי האוטומטי מזהה בוודאות. */
export const TEMPLATE_FIELDS: Field[] = [
  'full_name', 'branch', 'grade', 'parent_name', 'parent_phone', 'alt_phone', 'address', 'email',
  'status', 'joined_on', 'tuition_total', 'discount', 'discount_reason', 'installments', 'photo_consent', 'notes',
];

export function buildTemplateAoa(branchExample: string): CellValue[][] {
  const example: Record<Field, CellValue> = {
    full_name: 'שירה כהן', branch: branchExample, grade: 'ה', group_name: '', parent_name: 'רחל כהן',
    parent_phone: '052-1234567', alt_phone: '', address: 'הרב שך 12', email: '', status: 'פעילה',
    joined_on: '01/09/2026', birth_date: '', tuition_total: 2000, discount: 0, discount_reason: '',
    installments: 3, photo_consent: 'כן', notes: '',
  };
  return [TEMPLATE_FIELDS.map((f) => FIELD_LABEL[f]), TEMPLATE_FIELDS.map((f) => example[f])];
}

/** עמודות דוח השגיאות לייצוא. */
export const ERROR_COLUMNS: Column<RowError & { name: string }>[] = [
  { label: 'שורה', value: (e) => e.line, numeric: true },
  { label: 'שם', value: (e) => e.name },
  { label: 'שדה', value: (e) => (e.field ? FIELD_LABEL[e.field] : 'כללי') },
  { label: 'שגיאה', value: (e) => e.message },
  { label: 'ערך', value: (e) => e.value ?? '' },
];
