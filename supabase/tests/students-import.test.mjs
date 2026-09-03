#!/usr/bin/env node
/**
 * ★ ייבוא של 50 שורות עובר עם דוח שגיאות (תנאי הקבלה של שלב 6).
 *
 * חוברת אקסל אמיתית נבנית כאן — 50 שורות, מעורבות: תקינות, שגיאות מכל
 * סוג, כפילויות, תאריך כמספר סידורי, "כן" באישור צילום — נכתבת לבתים,
 * נקראת בחזרה, ועוברת את המיפוי האוטומטי והפרסור של הייצור.
 * הראיה: מספר התקינות והשגיאות ידוע מראש, וכל שגיאה נמצאת בשורה שלה
 * ובעברית. שורה פגומה לא עוצרת את התקינות ולא נבלעת.
 *
 * הרצה:  npm run test:import
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf } from './_code.mjs';

const dir = mkdtempSync(join(tmpdir(), 'import-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=cjs', '--platform=node', `--outfile=${out}`,
    '--log-level=error', '--alias:@=./src'], { stdio: 'inherit' });
  return out;
};
const load = async (src, name) => { const m = await import(bundle(src, name)); return m.default ?? m; };
const core = await load('src/lib/export-core.ts', 'export-core.cjs');
const imp = await load('src/lib/import-core.ts', 'import-core.cjs');

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

// ─── ההקשר: סניפים ותלמידות קיימות ───
const ctx = {
  branches: [
    { id: 'b1', name: 'ביתר עילית', default_tuition: 2000 },
    { id: 'b2', name: 'מודיעין עילית', default_tuition: 2100 },
  ],
  existing: [{ full_name: 'קיימת כבר', branch_id: 'b1', parent_phone: '972521111111' }],
};

// ─── 50 שורות: כותרות "אנושיות", לא שמות השדות ───
const HEADERS = ['שם התלמידה', 'סניף', 'כיתה', 'שם ההורה', 'טלפון', 'סטטוס', 'תאריך הצטרפות', 'שכר לימוד', 'הנחה', 'תשלומים', 'אישור צילום', 'הערות'];
const rows = [];
const good = (i, extra = {}) => ({
  name: `תלמידה ${i}`, branch: i % 2 ? 'ביתר עילית' : 'מודיעין עילית', grade: 'ה', parent: `הורה ${i}`,
  phone: `052-${String(1000000 + i).slice(0, 3)}-${String(1000000 + i).slice(3)}`,
  status: 'פעילה', joined: '01/09/2026', tuition: 2000, discount: 0, inst: 3, consent: 'כן', notes: '', ...extra,
});
const EXPECTED_ERRORS = {}; // line → תיאור
for (let i = 1; i <= 50; i++) {
  const line = i + 1;
  let r = good(i);
  if (i === 5)  { r = good(i, { name: '' });                     EXPECTED_ERRORS[line] = 'חסר שם'; }
  if (i === 9)  { r = good(i, { branch: 'חיפה' });               EXPECTED_ERRORS[line] = 'סניף לא מוכר'; }
  if (i === 12) { r = good(i, { phone: '12345' });               EXPECTED_ERRORS[line] = 'טלפון לא תקין'; }
  if (i === 15) { r = good(i, { status: 'בחופשה' });             EXPECTED_ERRORS[line] = 'סטטוס לא מוכר'; }
  if (i === 18) { r = good(i, { joined: '31/02/2026' });         EXPECTED_ERRORS[line] = 'תאריך הצטרפות לא תקין'; }
  if (i === 21) { r = good(i, { tuition: 'אלפיים' });            EXPECTED_ERRORS[line] = 'שכר לימוד לא תקין'; }
  if (i === 24) { r = good(i, { inst: 40 });                     EXPECTED_ERRORS[line] = 'מספר תשלומים לא תקין'; }
  if (i === 27) { r = good(i, { consent: 'אולי' });              EXPECTED_ERRORS[line] = 'אישור צילום'; }
  if (i === 30) { r = good(i, { name: 'תלמידה 29', branch: 'ביתר עילית' }); EXPECTED_ERRORS[line] = 'כפולה של שורה'; }
  if (i === 29) { r = good(i, { branch: 'ביתר עילית' }); }
  if (i === 33) { r = good(i, { name: 'קיימת כבר', branch: 'ביתר עילית' }); EXPECTED_ERRORS[line] = 'כבר קיימת במערכת'; }
  if (i === 36) { r = good(i, { branch: '' });                   EXPECTED_ERRORS[line] = 'חסר סניף'; }
  // ─── מקרים תקינים מיוחדים ───
  if (i === 40) { r = good(i, { joined: 46266 }); }              // מספר סידורי של אקסל = 2026-09-01
  if (i === 41) { r = good(i, { tuition: '' }); }                // ברירת המחדל של הסניף
  if (i === 42) { r = good(i, { phone: '' }); }                  // בלי טלפון — אזהרה, לא שגיאה
  if (i === 43) { r = good(i, { status: 'הפסיקה' }); }
  if (i === 44) { r = good(i, { consent: 'לא' }); }
  if (i === 45) { r = good(i, { phone: '+972-52-9876543' }); }   // פורמט בינלאומי
  if (i === 46) { r = good(i, { tuition: '₪1,800' }); }          // סכום מעוצב
  rows.push([r.name, r.branch, r.grade, r.parent, r.phone, r.status, r.joined, r.tuition, r.discount, r.inst, r.consent, r.notes]);
}
const aoa = [HEADERS, ...rows];

// ─── כתיבה וקריאה חוזרת — כמו קובץ של הלקוחה ───
const cols = HEADERS.map((h, i) => ({ label: h, value: (r) => r[i] }));
const buf = core.workbookToBuffer(core.buildWorkbook([{ name: 'תלמידות', columns: cols, rows }]));
const back = core.sheetToAoa(core.readWorkbook(new Uint8Array(buf)));
check('★ החוברת נקראת בחזרה: 50 שורות + כותרות', back.length === 51, `${back.length}`);

// ─── מיפוי אוטומטי ───
console.log('\nמיפוי עמודות:');
const mapping = imp.autoMap(back[0]);
check('★ כל 12 הכותרות זוהו אוטומטית', mapping.every(Boolean), JSON.stringify(mapping));
check('שם התלמידה → full_name, טלפון → parent_phone, אישור צילום → photo_consent',
      mapping[0] === 'full_name' && mapping[4] === 'parent_phone' && mapping[10] === 'photo_consent');
check('כותרת זרה אינה ממופה', imp.autoMap(['מספר נעליים']).every((m) => m === null));
check('שדה מזוהה פעם אחת בלבד', JSON.stringify(imp.autoMap(['טלפון', 'טלפון'])) === JSON.stringify(['parent_phone', null]));

// ─── פרסור ───
console.log('\nפרסור 50 שורות:');
const parsed = imp.parseRows(back, mapping, ctx);
const valid = parsed.filter((p) => p.row && p.errors.length === 0);
const invalid = parsed.filter((p) => p.errors.length > 0);
const expectedInvalid = Object.keys(EXPECTED_ERRORS).length;
check('★ כל 50 השורות עברו פרסור', parsed.length === 50, `${parsed.length}`);
check(`★ ${expectedInvalid} שורות עם שגיאות, ${50 - expectedInvalid} תקינות`,
      invalid.length === expectedInvalid && valid.length === 50 - expectedInvalid,
      `שגיאות: ${invalid.length}, תקינות: ${valid.length}`);
for (const [line, msg] of Object.entries(EXPECTED_ERRORS)) {
  const p = parsed.find((x) => x.line === Number(line));
  check(`שורה ${line}: "${msg}"`, p && p.errors.some((e) => e.message.includes(msg)), p ? p.errors.map((e) => e.message).join(' · ') : 'לא נמצאה');
}
check('★ שגיאה אינה עוצרת: השורה שאחרי שורה פגומה תקינה', parsed.find((x) => x.line === 7)?.row !== null);
check('★ כל השגיאות בעברית', invalid.every((p) => p.errors.every((e) => /[֐-׿]/.test(e.message))));

console.log('\nנרמול:');
const byLine = (n) => parsed.find((x) => x.line === n);
check('★ טלפון מנורמל ל-972', byLine(2).row.parent_phone === '972521000001');
check('פורמט בינלאומי +972 מנורמל', byLine(46).row.parent_phone === '972529876543');
check('★ תאריך כמספר סידורי של אקסל → 2026-09-01', byLine(41).row.joined_on === '2026-09-01');
check('תאריך dd/MM/yyyy → ISO', byLine(2).row.joined_on === '2026-09-01');
check('★ שכר לימוד ריק → ברירת המחדל של הסניף', byLine(42).row.tuition_total === 2000 && byLine(42).warnings.some((w) => /ברירת המחדל/.test(w)));
check('סכום מעוצב "₪1,800" → 1800', byLine(47).row.tuition_total === 1800);
check('בלי טלפון: אזהרה, לא שגיאה', byLine(43).row !== null && byLine(43).warnings.some((w) => /תזכורות/.test(w)));
check('סטטוס "הפסיקה" → stopped', byLine(44).row.status === 'stopped');
check('אישור צילום "כן" → true, "לא" → false', byLine(2).row.photo_consent === true && byLine(45).row.photo_consent === false);
check('source = import', valid.every((p) => p.row.source === 'import'));
check('הסניף נפתר למזהה', byLine(2).row.branch_id === 'b1' && byLine(3).row.branch_id === 'b2');

// ─── התבנית להורדה עוברת את המיפוי שלנו ───
console.log('\nתבנית:');
const tpl = imp.buildTemplateAoa('ביתר עילית');
const tplMap = imp.autoMap(tpl[0]);
check('★ כל עמודות התבנית מזוהות אוטומטית', tplMap.every(Boolean), JSON.stringify(tplMap));
const tplParsed = imp.parseRows(tpl, tplMap, ctx);
check('שורת הדוגמה בתבנית תקינה', tplParsed.length === 1 && tplParsed[0].errors.length === 0, JSON.stringify(tplParsed[0]?.errors));

// ─── מבני ───
console.log('\nמבני:');
check('ליבת הייבוא טהורה — בלי DOM ובלי supabase', !/document\.|window\.|@\/lib\/supabase/.test(codeOf('src/lib/import-core.ts')));
const comp = codeOf('src/components/ImportStudents.tsx');
check('★ הרכיב מייבא רק שורות תקינות', /valid\.map\(/.test(comp));
check('הרכיב מציע דוח שגיאות להורדה', /downloadErrors/.test(comp));
check('הרכיב עובר דרך parseRows ו-autoMap של הליבה', /parseRows\(/.test(comp) && /autoMap\(/.test(comp));

console.log(fails === 0 ? '\nייבוא: 50 שורות, דוח שגיאות מלא' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
