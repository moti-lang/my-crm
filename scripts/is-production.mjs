/**
 * בודק אם מסד הענן נעול כמסד ייצור (settings.production_lock = true).
 * יציאה 0 = נעול, 1 = לא נעול, 2 = שגיאה. verify-cloud.sh משתמש בזה כדי
 * לא לטעון נתוני דמו וזהויות בדיקה (שלב 2) ולא להריץ את חבילות הבדיקה
 * שכותבות ומניחות את נתוני הזרע (שלב 4) על מסד עם נתונים אמיתיים.
 */
import { makeExecutor } from './supabase-api.mjs';

const log = console.log; console.log = () => {};
try {
  const ex = await makeExecutor();
  const rows = await ex.run("select coalesce((select value from settings where key = 'production_lock'), 'false'::jsonb) as v");
  await ex.close();
  console.log = log;
  const v = rows[0]?.v;
  process.exit(v === true || v === 'true' ? 0 : 1);
} catch (e) {
  console.log = log;
  console.error(`  ✗ לא הצלחתי לבדוק את נעילת הייצור: ${e.message}`);
  process.exit(2);
}
