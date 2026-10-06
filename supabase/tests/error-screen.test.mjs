// מסך הקריסה: "פרטים טכניים" מציג את השגיאה האמיתית — לא טקסט גנרי.
// הלקח: humanError הפך כל שגיאת render ל"משהו השתבש. נסי שוב." ואי אפשר היה לדווח על תקלה.
import { fileURLToPath } from 'node:url';
import { codeOf } from './_code.mjs';
const eb = codeOf(fileURLToPath(new URL('../../src/components/ErrorBoundary.tsx', import.meta.url)));
let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const pre = eb.slice(eb.indexOf('data-testid="error-details"'), eb.indexOf('</pre>', eb.indexOf('data-testid="error-details"')));
check('★ הפרטים הטכניים מציגים את errorDetails (השגיאה האמיתית)', /\{details\}/.test(pre) && /const details = errorDetails\(this\.state\.error, this\.state\.stack\)/.test(eb));
check('★ לא humanError — שמחליף כל שגיאה טכנית בטקסט גנרי', !/humanError/.test(eb));
check('errorDetails כולל את ההודעה, מיקום בקוד, הרכיבים והדף', /\$\{error\.name\}: \$\{error\.message\}/.test(eb) && /error\.stack/.test(eb) && /componentStack/.test(eb) && /location\.pathname/.test(eb));
check('ה-componentStack נשמר מ-componentDidCatch', /this\.setState\(\{ stack: info\.componentStack/.test(eb));
check('כפתור העתקה', /navigator\.clipboard\?\.writeText\(details\)/.test(eb));
if (failed) { console.log(`  ✗ ${failed} בדיקות מסך הקריסה נכשלו`); process.exit(1); }
console.log('  כל בדיקות מסך הקריסה עברו');
