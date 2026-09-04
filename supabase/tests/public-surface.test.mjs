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
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

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

// ─── גוגל בלבד בקונפיג ───
// config.toml: הערות מתחילות ב-# — מסירים אותן כדי שהגדרה בהערה לא תיחשב.
// [auth] enable_signup נשאר true בכוונה: כניסה ראשונה בגוגל היא טכנית
// הרשמה, והדלת נסגרת בטריגר על auth.users. מה שחייב להיות סגור הוא
// ספק האימייל — אין סיסמאות בכלל.
const cfg = rawOf('supabase/config.toml').replace(/#[^\n]*/g, ' ');
const section = (name) => {
  const m = cfg.match(new RegExp(`\\[${name.replace(/\./g, '\\.')}\\]([^\\[]*)`));
  return m ? m[1] : '';
};
check('★ [auth.email] enable_signup = false — אין הרשמה באימייל',
      /enable_signup\s*=\s*false/.test(section('auth.email')));
check('★ [auth.external.google] enabled = true', /enabled\s*=\s*true/.test(section('auth.external.google')));
check('סוד גוגל מגיע ממשתנה סביבה, לא מהקובץ',
      /secret\s*=\s*"env\(GOOGLE_CLIENT_SECRET\)"/.test(section('auth.external.google')));

// ─── אין כניסה בסיסמה בקוד הלקוח ───
// לא רק שהשדות הוסרו מהמסך: אף קריאה כזו לא קיימת בקוד, בשום קובץ.
const srcFiles = walk('src').filter((f) => /\.(ts|tsx)$/.test(f));
const passwordCalls = srcFiles.filter((f) =>
  /\.auth\.(signInWithPassword|signUp|signInWithOtp|resetPasswordForEmail|updateUser)\s*\(/.test(codeOf(f)));
check('★ אף קובץ בקוד הלקוח אינו מתחבר בסיסמה', passwordCalls.length === 0,
      `נמצא ב: ${passwordCalls.join(', ')}`);
const auth = codeOf('src/auth/AuthProvider.tsx');
check('★ הכניסה היא signInWithOAuth עם google', /signInWithOAuth\(\{\s*provider:\s*'google'/.test(auth));
check('★ שגיאת חזרה מ-OAuth נתפסת (חשבון שנדחה במסד)', /oauthErrorFromUrl\(/.test(auth));
check('★ הפרופיל נבדק מחדש בחזרה לפוקוס (משתמשת שהושבתה תוך כדי)',
      /addEventListener\('visibilitychange'/.test(auth) && /\}, \[session, profileTick\]\);/.test(auth));

// ─── שום מסך אחר אינו נטען בלי session ───
const gate = app.slice(app.indexOf('function Gate()'), app.indexOf('export default'));
check('★ Gate מציג Login כשאין session, ו-NoAccess כשגוגל החזיר דחייה',
      /if \(!session\) return denied \? <NoAccess[^;]*: <Login \/>;/.test(gate));
check('★ Gate חוסם כשאין פרופיל או כשהוא מושבת',
      /if \(!profile \|\| !profile\.is_active\)/.test(gate));
check('★ Gate מציג מסך "אין הרשאה" ולא את המערכת', /<NoAccess/.test(gate));
check('★ מסך ניהול המשתמשים נגיש לבעלים בלבד',
      /profile\.role === 'owner' && <Route path="\/users"/.test(gate));

console.log(fails === 0
  ? '\nמשטח ציבורי: דף אחד, RPC בלבד'
  : `\n${fails} בדיקות נכשלו — ייתכן מסך חשוף`);
process.exit(fails ? 1 : 0);
