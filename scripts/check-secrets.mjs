#!/usr/bin/env node
/**
 * ★ שער בילד: סוד שדלף לצד הלקוח.
 *
 * כל מה שמתחיל ב-VITE_ נארז לתוך קוד הדפדפן וגלוי לכל מי שפותח
 * את הדף. service_role עוקף RLS לחלוטין; מפתח Anthropic ניתן
 * לחיוב. דליפה של אחד מהם אינה באג שמתקנים — היא מפתח שצריך
 * להחליף, ואי אפשר לדעת מי כבר לקח אותו.
 *
 * שתי בדיקות:
 *   1. שמות משתני VITE_ — לפני הבילד.
 *   2. תוכן dist/ — אחרי. תופס גם הטמעה ידנית בקוד.
 *
 * רץ כחלק מ-npm run build ולא כצעד נפרד, כדי שאי אפשר לדלג עליו.
 *
 *   node scripts/check-secrets.mjs          # שמות בלבד
 *   node scripts/check-secrets.mjs --dist   # גם תוכן הבילד
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let fails = 0;
const fail = (msg) => { fails++; console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** שמות שאסור שיופיעו עם קידומת VITE_. */
const FORBIDDEN_NAME = /VITE_.*(SERVICE_ROLE|SERVICE|SECRET|ANTHROPIC|PRIVATE|PASSWORD|_KEY$)/i;
/** חריגים: אלה אמורים להיות בצד הלקוח. */
const ALLOWED = new Set(['VITE_SUPABASE_ANON_KEY']);

// ─────────── 1. משתני הסביבה ───────────
console.log('\nמשתני VITE_:');
const sources = { ...process.env };
for (const f of ['.env', '.env.local', '.env.production']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) sources[m[1]] = m[2];
  }
}

let checked = 0;
for (const [name, value] of Object.entries(sources)) {
  if (!name.startsWith('VITE_')) continue;
  checked++;
  if (FORBIDDEN_NAME.test(name) && !ALLOWED.has(name)) {
    fail(`${name} — שם שמרמז על סוד, והוא נארז לדפדפן`);
    continue;
  }
  // גם אם השם תמים, הערך עשוי להיות סוד
  const v = String(value ?? '');
  if (v.startsWith('sk-ant-')) fail(`${name} מכיל מפתח Anthropic`);
  if (isServiceRoleJwt(v))     fail(`★ ${name} מכיל JWT של service_role`);
}
if (checked === 0) console.log('  (אין משתני VITE_ בסביבה הזו)');
else if (fails === 0) ok(`${checked} משתני VITE_ נקיים`);

/** JWT של סופבייס עם role=service_role בגוף. */
function isServiceRoleJwt(v) {
  const m = v.match(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\./);
  if (!m) return false;
  try {
    const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString());
    return payload.role === 'service_role';
  } catch { return false; }
}

// ─────────── 2. תוכן הבילד ───────────
if (process.argv.includes('--dist')) {
  console.log('\nתוכן dist/:');
  if (!existsSync('dist')) {
    fail('אין dist/ — יש לבנות קודם');
  } else {
    const files = [];
    (function walk(d) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|css|html|map|json)$/.test(n)) files.push(p);
      }
    })('dist');

    let found = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (src.includes('sk-ant-')) { fail(`★ ${f} מכיל מפתח Anthropic`); found++; }
      // כל JWT בבילד — לבדוק שאינו service_role
      for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\./g)) {
        try {
          const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString());
          if (payload.role === 'service_role') {
            fail(`★ ${f} מכיל JWT של service_role`); found++;
          }
        } catch { /* לא JWT */ }
      }
      for (const marker of ['SUPABASE_SERVICE_ROLE_KEY', 'WA_API_KEY', 'WA_WEBHOOK_SECRET']) {
        if (src.includes(marker)) { fail(`★ ${f} מזכיר ${marker}`); found++; }
      }
    }
    if (found === 0) ok(`${files.length} קבצים נסרקו, אין סודות`);
  }
}

console.log(fails === 0
  ? '\nאין סודות בצד הלקוח\n'
  : `\n★ ${fails} דליפות. הבילד נעצר.\n  מפתח שדלף צריך החלפה, לא תיקון.\n`);
process.exit(fails ? 1 : 0);
