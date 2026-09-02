#!/usr/bin/env node
/**
 * Supabase Management API — SQL וקונפיגורציית פרויקט דרך HTTPS.
 *
 * למה זה קיים: יש סביבות (סנדבוקס של סוכן, CI מוגבל) שבהן יוצא רק
 * HTTPS. פורט 5432 חסום שם, ולכן psql ו-pg אינם יכולים להגיע למסד —
 * גם עם מחרוזת חיבור נכונה. ה-Management API מריץ SQL על הפרויקט
 * דרך HTTPS, עם Personal Access Token מ-
 * supabase.com/dashboard/account/tokens (מתחיל ב-sbp_).
 *
 * הטוקן הוא סוד ברמת החשבון, לא ברמת הפרויקט. הוא חי ב-.env.verify
 * בלבד — לעולם לא בקוד, לא ב-VITE_, ולא ב-dist/ (check-secrets.mjs
 * תופס אותו).
 *
 * מגבלה ידועה: כל קריאה היא שאילתה אחת בחיבור משלה. אי אפשר להחזיק
 * טרנזקציה פתוחה בין קריאות, ולכן בדיקה שדורשת שני חיבורים חיים
 * במקביל (command-race) אינה רצה במסלול הזה.
 *
 * מבצע (executor) אחד לשני יעדים:
 *   SUPABASE_ACCESS_TOKEN → הענן, דרך ה-API.
 *   PGURL (בלי טוקן)      → pg ישיר. קיים כדי לאמת את הסקריפטים
 *                           האלה מול פוסטגרס מקומי לפני שנוגעים בענן.
 * בשני המסלולים כל קריאה ל-run() היא שאילתה פשוטה אחת (simple query):
 * כמה משפטים, טרנזקציה משתמעת אחת — או שהכול מוחל, או שכלום.
 */
import { readFileSync, existsSync } from 'node:fs';

export function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (!(key in process.env)) process.env[key] = value.replace(/^["']|["']$/g, '');
  }
}
loadEnvFile('.env.verify');
loadEnvFile('.env.local');

const API = 'https://api.supabase.com';

/** מחלץ הודעת שגיאה קריאה מכל צורת תשובה של ה-API. */
function messageOf(body, text) {
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string') return body.message;
    if (body.error && typeof body.error === 'object' && body.error.message) return body.error.message;
    if (typeof body.error === 'string') return body.error;
  }
  return text || '(ללא גוף)';
}

export function api(token) {
  return async function call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const err = new Error(`${method} ${path} → HTTP ${res.status}: ${messageOf(json, text)}`);
      err.status = res.status;
      err.body = json ?? text;
      throw err;
    }
    return json;
  };
}

/**
 * ★ נעילת יעד. בחשבון יש עוד פרויקטים; מיגרציה על הפרויקט הלא נכון
 * היא נזק בלתי הפיך. הפרויקט חייב להימצא תחת ה-ref המדויק ולהיות פעיל.
 */
export async function assertTarget(call, ref) {
  let p;
  try {
    p = await call('GET', `/v1/projects/${ref}`);
  } catch (e) {
    throw new Error(`היעד ${ref} אינו נגיש עם הטוקן הזה — לא רצה כלום (${e.message})`);
  }
  if (p.id !== ref) throw new Error(`היעד אינו תואם: התקבל ${p.id}, מצופה ${ref}`);
  if (p.status && p.status !== 'ACTIVE_HEALTHY') {
    throw new Error(`הפרויקט ${ref} במצב ${p.status} — לא רצה כלום`);
  }
  return p;
}

function normalizeRows(result) {
  // pg: Result או Result[] (ריבוי משפטים) — לוקחים את האחרון.
  if (Array.isArray(result) && result.length && result[0] && 'rows' in result[0]) {
    return result[result.length - 1].rows;
  }
  if (result && typeof result === 'object' && 'rows' in result) return result.rows;
  // ה-API: מערך שורות של המשפט האחרון.
  return Array.isArray(result) ? result : [];
}

/**
 * מחזיר { label, run(sql) → rows, reset(), close() }.
 * run מקבל טקסט SQL שלם ומריץ אותו כשאילתה פשוטה אחת.
 * reset מנקה טרנזקציה שנשארה פתוחה אחרי שגיאה: ב-API כל קריאה היא
 * חיבור משלה ואין מה לנקות; ב-pg הישיר צריך rollback מפורש.
 */
export async function makeExecutor() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  const pgurl = process.env.PGURL;

  if (token) {
    if (!ref) throw new Error('יש SUPABASE_ACCESS_TOKEN אבל אין SUPABASE_PROJECT_REF — בלי נעילת יעד לא רצים');
    if (!token.startsWith('sbp_')) {
      console.error('  ! SUPABASE_ACCESS_TOKEN אינו מתחיל ב-sbp_ — זה לא נראה כמו Personal Access Token');
    }
    const call = api(token);
    const project = await assertTarget(call, ref);
    console.log(`  ✓ יעד מאומת (Management API): ${project.name} · ${ref} · ${project.region ?? '?'}`);
    return {
      label: 'api',
      call,
      ref,
      async run(sql) {
        const rows = await call('POST', `/v1/projects/${ref}/database/query`, { query: sql, read_only: false });
        return normalizeRows(rows);
      },
      async reset() {},
      async close() {},
    };
  }

  if (pgurl) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: pgurl });
    await client.connect();
    const db = (await client.query('select current_database() d')).rows[0].d;
    console.log(`  → מסלול pg ישיר (PGURL): ${db}`);
    return {
      label: 'pg',
      async run(sql) { return normalizeRows(await client.query(sql)); },
      async reset() { await client.query('rollback').catch(() => {}); },
      async close() { await client.end(); },
    };
  }

  throw new Error('אין SUPABASE_ACCESS_TOKEN (ענן) ואין PGURL (מקומי)');
}

/** מחרוזת SQL בטוחה — מזהי מיגרציה מגיעים משמות קבצים, אבל לא מנחשים. */
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
