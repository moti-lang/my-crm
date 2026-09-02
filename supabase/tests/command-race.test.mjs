#!/usr/bin/env node
/**
 * ★ מרוץ אישורים — הבדיקה החשובה ביותר בסבב 6ב.
 *
 * התרחיש: הבעלים כותבת "כן", הרשת מגמגמת, השרת שולח שוב. שני
 * webhooks מגיעים כמעט בו זמנית לאותה פקודה ממתינה. אם שניהם
 * מבצעים — ההוצאה נרשמת פעמיים.
 *
 * ההגנה היא UPDATE ... WHERE status='pending_confirm' RETURNING:
 * השנייה נחסמת על נעילת השורה, ואחרי ה-COMMIT של הראשונה מעריכה
 * מחדש את התנאי ומקבלת אפס שורות.
 *
 * הבדיקה משתמשת בחיבורים אמיתיים ונפרדים — לא בסימולציה — כי זה
 * המנגנון היחיד שמוכיח את הטענה.
 *
 * הרצה:  npm run test:race
 */
import pg from 'pg';

// מקומי כברירת מחדל; PGURL מפנה אותו לענן בשלב 4 של סבב האימות.
const CONN = process.env.PGURL
  ? { connectionString: process.env.PGURL }
  : { host: '/tmp', port: 5433, user: 'postgres', database: 'teichtal' };

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const admin = new pg.Client(CONN);
await admin.connect();

async function makePending(text = 'שילמתי 860 תלבושות בביתר', amount = 860) {
  await admin.query(`delete from audit_log where source = 'whatsapp'`);
  await admin.query(`delete from commands where phone = '972501234567'`);
  await admin.query(
    `delete from ledger_entries where source = 'whatsapp'`);
  const { rows } = await admin.query(
    `select rpc_create_pending_command($1,$2,$3,$4) as id`,
    ['972501234567', text, JSON.stringify({
      intent: 'expense', confidence: 0.94,
      fields: { amount, branch: 'ביתר עילית', category: 'תלבושות' },
      missing: [], human_summary: 'הוצאה',
    }), 'expense'],
  );
  return rows[0].id;
}

const countEntries = async () => Number(
  (await admin.query(`select count(*)::int c from ledger_entries where source='whatsapp' and deleted_at is null`)).rows[0].c);

// ═══════════ 1. שני חיבורים עם חפיפה מכוונת ═══════════
console.log('\nשני אישורים חופפים (interleaving דטרמיניסטי):');
{
  const id = await makePending();
  const a = new pg.Client(CONN); const b = new pg.Client(CONN);
  await a.connect(); await b.connect();

  await a.query('begin');
  const first = await a.query('select rpc_execute_command($1) as r', [id]);

  await b.query('begin');
  // ★ לא ממתינים — הבקשה נחסמת על נעילת השורה של a
  const secondPromise = b.query('select rpc_execute_command($1) as r', [id]);

  // נותנים ל-b להגיע לנעילה, ורק אז משחררים את a
  await new Promise((r) => setTimeout(r, 250));
  await a.query('commit');

  const second = await secondPromise;
  await b.query('commit');

  check('הראשון הצליח', first.rows[0].r.ok === true);
  check('★ השני נדחה', second.rows[0].r.ok === false,
        `התקבל: ${JSON.stringify(second.rows[0].r)}`);
  check('★ הסיבה: כבר טופלה', second.rows[0].r.reason === 'already_handled',
        `התקבל: ${second.rows[0].r.reason}`);
  check('★ נוצרה רשומת הוצאה אחת בלבד', (await countEntries()) === 1,
        `נמצאו ${await countEntries()} רשומות`);

  await a.end(); await b.end();
}

// ═══════════ 2. עשרה אישורים במקביל ═══════════
console.log('\nעשרה אישורים במקביל:');
{
  const id = await makePending('שילמתי 1200 שכירות בביתר', 1200);
  const clients = await Promise.all(
    Array.from({ length: 10 }, async () => { const c = new pg.Client(CONN); await c.connect(); return c; }));

  const results = await Promise.all(
    clients.map((c) => c.query('select rpc_execute_command($1) as r', [id]).then((x) => x.rows[0].r)));

  const succeeded = results.filter((r) => r.ok).length;
  const alreadyHandled = results.filter((r) => !r.ok && r.reason === 'already_handled').length;

  check('★ בדיוק אישור אחד הצליח', succeeded === 1, `הצליחו ${succeeded}`);
  check('★ תשעה קיבלו already_handled', alreadyHandled === 9, `קיבלו ${alreadyHandled}`);
  check('★ נוצרה רשומת הוצאה אחת בלבד', (await countEntries()) === 1,
        `נמצאו ${await countEntries()} רשומות`);

  const { rows } = await admin.query(`select status, result_id from commands where id = $1`, [id]);
  check('הפקודה במצב applied', rows[0].status === 'applied');
  check('נשמר מזהה התוצאה', rows[0].result_id !== null);

  await Promise.all(clients.map((c) => c.end()));
}

// ═══════════ 3. ביטול כפול ═══════════
console.log('\nשני ביטולים במקביל:');
{
  const id = await makePending('שילמתי 450 הגברה בביתר', 450);
  await admin.query('select rpc_execute_command($1)', [id]);

  const clients = await Promise.all(
    Array.from({ length: 5 }, async () => { const c = new pg.Client(CONN); await c.connect(); return c; }));
  const results = await Promise.all(
    clients.map((c) => c.query('select rpc_cancel_command($1) as r', [id]).then((x) => x.rows[0].r)));

  check('★ בדיוק ביטול אחד הצליח', results.filter((r) => r.ok).length === 1,
        `הצליחו ${results.filter((r) => r.ok).length}`);
  check('★ הרשומה נמחקה רכות פעם אחת', (await countEntries()) === 0);
  await Promise.all(clients.map((c) => c.end()));
}

// ═══════════ 4. פקודה שפג תוקפה ═══════════
console.log('\nפקיעת תוקף:');
{
  const id = await makePending('שילמתי 300 כיבוד בביתר', 300);
  await admin.query(`update commands set expires_at = now() - interval '1 minute' where id = $1`, [id]);
  const { rows } = await admin.query('select rpc_execute_command($1) as r', [id]);
  check('★ פקודה שפג תוקפה אינה מתבצעת', rows[0].r.ok === false);
  check('הסיבה: expired', rows[0].r.reason === 'expired', `התקבל: ${rows[0].r.reason}`);
  check('★ לא נוצרה רשומה', (await countEntries()) === 0);
}

// ═══════════ 5. הודעה חדשה מבטלת ממתינה קודמת ═══════════
console.log('\nהודעה חדשה מחליפה ממתינה:');
{
  const first = await makePending('שילמתי 100 כיבוד בביתר', 100);
  const { rows: r2 } = await admin.query(
    `select rpc_create_pending_command($1,$2,$3,$4) as id`,
    ['972501234567', 'שילמתי 200 כיבוד בביתר',
     JSON.stringify({ intent: 'expense', confidence: 0.9,
       fields: { amount: 200, branch: 'ביתר עילית', category: 'כיבוד' }, missing: [], human_summary: 'x' }),
     'expense']);
  const second = r2[0].id;

  const { rows: st } = await admin.query('select status from commands where id = $1', [first]);
  check('★ הממתינה הקודמת בוטלה', st[0].status === 'cancelled', `התקבל: ${st[0].status}`);

  const { rows: ex } = await admin.query('select rpc_execute_command($1) as r', [first]);
  check('★ אי אפשר לאשר פקודה שהוחלפה', ex[0].r.ok === false);

  const { rows: ex2 } = await admin.query('select rpc_execute_command($1) as r', [second]);
  check('הפקודה החדשה כן מתבצעת', ex2[0].r.ok === true);
  check('★ נוצרה רשומה אחת בלבד', (await countEntries()) === 1);
}

await admin.query(`delete from ledger_entries where source='whatsapp'`);
await admin.query(`delete from commands where phone='972501234567'`);
await admin.query(`delete from audit_log where source='whatsapp'`);
await admin.end();

console.log(fails === 0
  ? '\nכל בדיקות מרוץ האישורים עברו'
  : `\n${fails} בדיקות נכשלו — פקודה עלולה להתבצע פעמיים`);
process.exit(fails ? 1 : 0);
