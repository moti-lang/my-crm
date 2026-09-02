#!/usr/bin/env node
/**
 * ★ משטח הציבורי: דף אחד בלבד.
 *
 * `/a/:token` הוא הדף היחיד שמישהו לא-מחובר אמור להגיע אליו. כל
 * השאר מאחורי AuthProvider. מסלול שיישמט החוצה בעריכה עתידית
 * ייחשף בלי שאף אחד ישים לב.
 *
 * הרצה:  npm run test:public
 */
import { codeOf, rawOf } from './_code.mjs';

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const app = codeOf('src/App.tsx');

// ─── המסלולים שמחוץ ל-AuthProvider ───
// המבנה: <Routes> ציבורי, ובתוכו route אחד שעוטף את השאר ב-AuthProvider.
const outer = app.slice(app.indexOf('<BrowserRouter>'), app.indexOf('<AuthProvider>'));
// "*" אינו מסלול ציבורי אלא העוטף שמפעיל את שער ההתחברות על כל השאר.
const publicRoutes = [...outer.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map((m) => m[1]).filter((r) => r !== '*');

console.log('\nמסלולים מחוץ לשער ההתחברות:');
for (const r of publicRoutes) console.log(`    ${r}`);

check('★ מסלול ציבורי אחד בלבד', publicRoutes.length === 1,
      `נמצאו: ${publicRoutes.join(', ')}`);
check('★ והוא /a/:token', publicRoutes[0] === '/a/:token',
      `נמצא: ${publicRoutes[0]}`);
// ה-catch-all חייב לעטוף את AuthProvider — אחרת "כל השאר" אינו מוגן.
check('★ המסלול "*" עוטף את AuthProvider',
      /path="\*"[\s\S]{0,200}<AuthProvider>/.test(app),
      'בלי זה כל מסך שאינו /a/:token נגיש בלי התחברות');

// ─── דף האחראית אינו נוגע בטבלאות ───
const sheet = codeOf('src/pages/AttendanceSheet.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
check('★ דף האחראית ניגש רק דרך RPC', !/\.from\(/.test(sheet),
      'הוא ניגש לטבלה ישירות — anon חסום מהן, אבל זו כוונה שגויה');
check('דף האחראית קורא לשתי ה-RPC בלבד',
      (sheet.match(/\.rpc\(/g) ?? []).length === 2);
check('★ דף האחראית אינו מייבא את AuthProvider', !/AuthProvider|useAuth/.test(sheet));

// ─── הרשמה עצמית סגורה בקונפיג ───
// config.toml: הערות מתחילות ב-# — מסירים אותן כדי ש-enable_signup
// בהערה לא ייחשב הגדרה.
const cfg = rawOf('supabase/config.toml').replace(/#[^\n]*/g, ' ');
check('★ enable_signup = false ב-config.toml', /enable_signup\s*=\s*false/.test(cfg));
check('שתי הופעות (auth ו-auth.email)',
      (cfg.match(/enable_signup\s*=\s*false/g) ?? []).length >= 2);

// ─── שום מסך אחר אינו נטען בלי session ───
const gate = app.slice(app.indexOf('function Gate()'), app.indexOf('export default'));
check('★ Gate מציג Login כשאין session', /if \(!session\) return <Login \/>/.test(gate));
check('★ Gate חוסם גם כשאין פרופיל', /if \(!profile\)/.test(gate));

console.log(fails === 0
  ? '\nמשטח ציבורי: דף אחד, RPC בלבד'
  : `\n${fails} בדיקות נכשלו — ייתכן מסך חשוף`);
process.exit(fails ? 1 : 0);
