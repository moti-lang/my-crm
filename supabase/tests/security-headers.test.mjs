#!/usr/bin/env node
/**
 * ★ כותרות האבטחה של האתר (netlify.toml) ובילד בלי source maps — ביקורת 11/2026.
 *   CSP שנמחק או נפתח ('unsafe-inline' לסקריפטים, 'unsafe-eval', חיבור לכל דומיין) — נופל כאן.
 *   שהאפליקציה עובדת תחת ה-CSP הזה בודקות כל בדיקות המסך (_ui.mjs מגיש איתו, הפרה = שגיאת דף).
 *   node supabase/tests/security-headers.test.mjs
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeOf, rawOf } from './_code.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const toml = rawOf(`${ROOT}/netlify.toml`);
// הכותרות של "/*" — הבלוק הראשון של [[headers]] עם for = "/*".
const block = (toml.match(/\[\[headers\]\]\s*\n\s*for = "\/\*"\s*\n\s*\[headers\.values\]([\s\S]*?)(?=\n\s*\n|\n#|\n\[\[)/) ?? [])[1] ?? '';
const header = (name) => (block.match(new RegExp(`^\\s*${name} = "([^"]+)"`, 'm')) ?? [])[1];

const csp = header('Content-Security-Policy') ?? '';
const dir = Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));
check('★ יש Content-Security-Policy לכל הדפים', csp.length > 0);
check("★ default-src 'self'", dir['default-src']?.join(' ') === "'self'", dir['default-src']?.join(' '));
check("★ script-src: רק 'self' — בלי 'unsafe-inline', 'unsafe-eval' או דומיין זר", dir['script-src']?.join(' ') === "'self'", dir['script-src']?.join(' '));
check("★ object-src 'none', base-uri 'self', frame-ancestors 'none'",
  dir['object-src']?.join(' ') === "'none'" && dir['base-uri']?.join(' ') === "'self'" && dir['frame-ancestors']?.join(' ') === "'none'");
check("★ form-action 'self' (טופס לא נשלח לאתר זר)", dir['form-action']?.join(' ') === "'self'");
const connect = dir['connect-src'] ?? [];
check('★ connect-src: האתר ופרויקט ה-Supabase בלבד (בלי * ובלי https: כללי)',
  connect.includes("'self'") && connect.some((s) => /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(s))
  && connect.every((s) => s === "'self'" || /^(https|wss):\/\/[a-z0-9]{20}\.supabase\.co$/.test(s)), connect.join(' '));
check("style-src בלי 'unsafe-eval' ובלי דומיין כללי", (dir['style-src'] ?? []).every((s) => ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'].includes(s)), dir['style-src']?.join(' '));
check('★ Strict-Transport-Security לשנה לפחות', /max-age=(\d+)/.test(header('Strict-Transport-Security') ?? '') && Number(/max-age=(\d+)/.exec(header('Strict-Transport-Security'))[1]) >= 31536000);
check('X-Frame-Options: DENY', header('X-Frame-Options') === 'DENY');
check('X-Content-Type-Options: nosniff', header('X-Content-Type-Options') === 'nosniff');
check('Referrer-Policy', /strict-origin|no-referrer/.test(header('Referrer-Policy') ?? ''));
check('Permissions-Policy: בלי מצלמה, מיקרופון ומיקום', /camera=\(\)/.test(header('Permissions-Policy') ?? '') && /microphone=\(\)/.test(header('Permissions-Policy') ?? '') && /geolocation=\(\)/.test(header('Permissions-Policy') ?? ''));

// בילד בלי source maps: הקוד המקורי (כולל הערות) לא יוצא לאתר.
const vite = ['vite.config.ts', 'vite.config.mts', 'vite.config.js'].map((f) => `${ROOT}/${f}`).find(existsSync);
const vcfg = vite ? codeOf(vite) : '';
check('★ vite: בלי source maps בבילד', !/sourcemap\s*:\s*(true|'inline'|"inline"|'hidden'|"hidden")/.test(vcfg));
// index.html בלי סקריפט inline (אחרת script-src 'self' היה שובר אותו, ומישהו היה "מתקן" ב-unsafe-inline).
const html = rawOf(`${ROOT}/index.html`);
check('index.html בלי סקריפט inline', [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].every((m) => /\bsrc=/.test(m[1]) && m[2].trim() === ''));

console.log(fails === 0 ? '\nכותרות האבטחה: הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
