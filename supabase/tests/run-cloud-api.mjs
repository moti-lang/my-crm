#!/usr/bin/env node
/**
 * שלב 4 דרך ה-Management API — כל חבילות ה-SQL מול הענן, כשפורט 5432 חסום.
 *
 * אותם קבצים בדיוק שרצים מקומית ב-psql. מה שמשתנה הוא רק המוביל:
 * במקום psql, כל חבילה נשלחת כשאילתה אחת ל-Management API (או ל-pg
 * ישיר עם PGURL — לאימות מקומי של המריץ הזה עצמו).
 *
 * מה שצריך לחקות מ-psql, ורק את זה:
 *   \set NAME value   — משתנה, מוצב במקום :NAME (מחוץ למחרוזות ולהערות)
 *   \ir file          — הכללת קובץ, יחסית לקובץ המכליל
 *   \echo text        — כותרת התקדמות; אינה SQL
 *   \set ON_ERROR_STOP — מובנה: שאילתה פשוטה נעצרת בשגיאה הראשונה,
 *                        והמשפטים שאחריה לא רצים. זו בדיוק ההתנהגות של psql.
 *
 * ★ פיצול לפי טרנזקציות. psql שולח כל משפט לבד, ולכן `create function`
 * שלפני ה-`begin;` הראשון מתחייב מיד. בשאילתה מרובת-משפטים הכללים
 * אחרים: `begin;` הופך את הטרנזקציה המשתמעת של כל מה שקדם לו
 * לטרנזקציה מפורשת, וה-`rollback;` שבסוף הבלוק מוחק גם את פונקציות
 * העזר. נתפס באימות מקומי: הבלוק השני נפל על "t_user does not exist".
 * לכן כל בלוק `begin; … rollback;` נשלח כשאילתה נפרדת, וכל מה שביניהם
 * — כשאילתה משלו שמתחייבת. אחרי שגיאה החיבור מתאפס, כדי ששגיאה אחת
 * לא תגרור "current transaction is aborted" לכל החבילות שאחריה.
 *
 * מה שאי אפשר לחקות, ונאמר במפורש:
 *   * RAISE NOTICE אינו מוחזר דרך ה-API. ✓ של assert לא נראה. מה שכן
 *     נראה: assert שנכשל מרים חריגה, והחבילה נופלת בקול רם עם ההודעה.
 *     "עברה" פירושו שאף assert לא זרק חריגה — אותה הוכחה, פחות טקסט.
 *   * command-race.test.mjs דורש שני חיבורים חיים במקביל. אין דבר כזה
 *     ב-API. הוא מדולג כאן, ומדווח כמדולג — לא כעובר.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeExecutor } from '../../scripts/supabase-api.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const SUITES = [
  '02_rls_proof.sql', '03_allocation_proof.sql', '04_wa_dedupe_proof.sql',
  '05_role_consistency_proof.sql', '06_attendance_proof.sql',
  '07_reminder_queue_proof.sql', '08_command_rollback_proof.sql',
];

/** ערך של \set לפי כללי psql: הארגומנטים משורשרים, '...' עם '' כבריחה. */
export function psqlValue(raw) {
  let out = '', inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQ) {
      if (c === "'") {
        if (raw[i + 1] === "'") { out += "'"; i++; } else inQ = false;
      } else out += c;
    } else if (c === "'") inQ = true;
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/**
 * הצבת :NAME מחוץ למחרוזות, לציטוט-דולר ולהערות — כמו psql.
 * :: (cast) אינו משתנה. שם לא מוגדר נשאר כמו שהוא.
 */
export function substitute(sql, vars) {
  const names = Object.keys(vars);
  if (!names.length) return sql;
  const isName = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
  let out = '', i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === '-' && n === '-') {                       // הערת שורה
      const e = sql.indexOf('\n', i); const end = e === -1 ? sql.length : e;
      out += sql.slice(i, end); i = end; continue;
    }
    if (c === '/' && n === '*') {                       // הערת בלוק
      const e = sql.indexOf('*/', i + 2); const end = e === -1 ? sql.length : e + 2;
      out += sql.slice(i, end); i = end; continue;
    }
    if (c === "'") {                                    // מחרוזת
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") j += 2; else break; } else j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') {                                    // מזהה מצוטט
      const e = sql.indexOf('"', i + 1); const end = e === -1 ? sql.length : e + 1;
      out += sql.slice(i, end); i = end; continue;
    }
    if (c === '$') {                                    // ציטוט-דולר $tag$...$tag$
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length); const end = e === -1 ? sql.length : e + m[0].length;
        out += sql.slice(i, end); i = end; continue;
      }
    }
    if (c === ':' && n !== ':' && (i === 0 || (sql[i - 1] !== ':' && !/\w/.test(sql[i - 1])))) {
      const m = sql.slice(i + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (m && isName(m[0]) && m[0] in vars) { out += vars[m[0]]; i += 1 + m[0].length; continue; }
    }
    out += c; i++;
  }
  return out;
}

/** קובץ psql → טקסט SQL אחד. מחזיר גם את כותרות ה-\echo, לפי הסדר. */
export function preprocess(path, vars = {}, echoes = []) {
  const src = readFileSync(path, 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*\\(\w+)\s?(.*)$/);
    if (!m) { out.push(substitute(line, vars)); continue; }
    const [, cmd, rest] = m;
    if (cmd === 'set') {
      const mm = rest.match(/^(\S+)\s*(.*)$/);
      if (mm) vars[mm[1]] = psqlValue(mm[2]);
    } else if (cmd === 'ir' || cmd === 'i') {
      out.push(preprocess(join(dirname(path), rest.trim()), vars, echoes).sql);
    } else if (cmd === 'echo') {
      echoes.push(rest);
    } else {
      throw new Error(`פקודת psql לא נתמכת ב-${basename(path)}: \\${cmd}`);
    }
  }
  return { sql: out.join('\n'), echoes };
}

const isBegin = (l) => /^\s*(begin|start\s+transaction)\s*;\s*(--.*)?$/i.test(l);
// רק rollback/commit — `end;` הוא גם סוף בלוק plpgsql, ואינו גבול טרנזקציה.
const isEnd   = (l) => /^\s*(rollback|commit)\s*;\s*(--.*)?$/i.test(l);

/**
 * מפצל SQL מעובד לשאילתות: כל בלוק `begin; … rollback;` הוא שאילתה
 * אחת; כל רצף משפטים שמחוץ לבלוק הוא שאילתה אחת. ראה הערת הכותרת.
 *
 * שורה בתוך ציטוט-דולר ($$ … $$, גוף של DO או פונקציה) לעולם אינה
 * גבול — גם אם כתוב בה `begin;`. נתפס באימות מקומי: `end;` בתוך DO
 * חתך את הבלוק באמצע המחרוזת.
 */
export function splitTransactions(sql) {
  const chunks = [];
  let cur = [], inBlock = false, dollar = null;
  const flush = () => { if (cur.some((l) => l.trim())) chunks.push(cur.join('\n')); cur = []; };
  for (const line of sql.split('\n')) {
    const boundaryOk = dollar === null;
    if (boundaryOk && !inBlock && isBegin(line)) { flush(); inBlock = true; cur.push(line); continue; }
    cur.push(line);
    if (boundaryOk && inBlock && isEnd(line)) { inBlock = false; flush(); }
    // מעקב אחרי ציטוטי-דולר לאורך השורה (יכולים להיפתח ולהיסגר באותה שורה).
    for (const m of line.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)?\$/g)) {
      if (dollar === null) dollar = m[0];
      else if (m[0] === dollar) dollar = null;
    }
  }
  if (dollar !== null) throw new Error('ציטוט-דולר לא סגור — הקובץ אינו מאוזן');
  if (inBlock) throw new Error('בלוק begin ללא rollback/commit — הקובץ אינו מאוזן');
  flush();
  return chunks;
}

/**
 * ספירה סטטית של קריאות assert בחבילה — מה שהיה מודפס כ-✓ ב-psql.
 * גם t_roles_agree (05), שהיא assert בשם אחר. הגדרות הפונקציות עצמן
 * (create … function) אינן נספרות.
 */
const countAsserts = (path) =>
  readFileSync(path, 'utf8').split('\n')
    .filter((l) => !/create\s+(or\s+replace\s+)?function/i.test(l))
    .reduce((n, l) => n + (l.match(/\b(assert_[a-z_]+|t_roles_agree)\s*\(/g) ?? []).length, 0);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ex = await makeExecutor();
  let fails = 0;
  for (const suite of SUITES) {
    console.log(`═══ ${suite} ═══`);
    const path = join(DIR, suite);
    let sql;
    try { ({ sql } = preprocess(path)); }
    catch (e) { console.log(`  ✗ ${e.message}`); fails++; continue; }
    let chunks;
    try { chunks = splitTransactions(sql); }
    catch (e) { console.log(`  ✗ ${e.message}`); fails++; continue; }
    try {
      for (const chunk of chunks) await ex.run(chunk);
      console.log(`  ✓ עברה — ${countAsserts(path)} קריאות assert ב-${chunks.length} טרנזקציות, אף אחת לא זרקה חריגה`);
    } catch (e) {
      console.log(`  ✗ ${suite} נפלה מול הענן:\n    ${e.message.split('\n').join('\n    ')}`);
      fails++;
      await ex.reset();
    }
  }
  console.log('═══ מרוץ אישורים ═══');
  console.log('  · command-race.test.mjs דולג: דורש שני חיבורי Postgres חיים במקביל, ואין כאלה דרך ה-API.');
  console.log('    הוא רץ מקומית וב-CI; מול הענן ירוץ כשיש SUPABASE_DB_URL.');
  await ex.close();
  console.log('═══════════════════════════════════════');
  console.log(fails === 0
    ? `כל ${SUITES.length} החבילות עברו מול הענן (מרוץ האישורים דולג)`
    : `${fails} חבילות נפלו`);
  process.exit(fails ? 1 : 0);
}
