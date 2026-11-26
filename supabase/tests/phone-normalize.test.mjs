#!/usr/bin/env node
/**
 * ★ נרמול טלפון אחד לכל המערכת: אותה טבלת מקרים (fixtures/phone-cases.json) רצה על
 *   _shared/phone.ts (השרת), על מה שהמסך מייבא (src/lib/format.ts, src/lib/enrollment.ts),
 *   ועל f_normalize_phone במסד. 05X / ‎+9725X / ‎9725X (ועוד) → אותו ערך.
 *   ובמבנה: המסך לא מחזיק עותק משלו, וההרשמה (rpc_enroll) משתמשת בנרמול של המסד.
 *   node supabase/tests/phone-normalize.test.mjs   (צריך את המסד המקומי — כמו run.sh)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeOf, rawOf } from './_code.mjs';

const CASES = JSON.parse(rawOf('supabase/tests/fixtures/phone-cases.json'));
const dir = mkdtempSync(join(tmpdir(), 'phone-'));
const bundle = (src, name) => {
  const out = join(dir, name);
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' });
  return out;
};
const server = await import(bundle('supabase/functions/_shared/phone.ts', 'phone.mjs'));
const format = await import(bundle('src/lib/format.ts', 'format.mjs'));
const enroll = await import(bundle('src/lib/enrollment.ts', 'enroll.mjs'));

let fails = 0;
const check = (label, ok, detail = '') => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };

const PG = ['-h', process.env.PGHOST ?? '/tmp', '-p', process.env.PGPORT ?? '5433', '-U', process.env.PGUSER ?? 'postgres', '-d', 'teichtal', '-Atq'];
const sql = (q) => execFileSync('psql', [...PG, '-c', q], { encoding: 'utf8' }).trim();
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const dbOut = sql(`select string_agg(coalesce(f_normalize_phone(x), 'NULL'), E'\\n' order by n) from unnest(array[${CASES.map(([i]) => lit(i)).join(',')}]::text[]) with ordinality t(x, n)`).split('\n');

console.log('\nאותו ערך — בשרת, במסך ובמסד:');
CASES.forEach(([input, want], i) => {
  const got = [server.normalizePhone(input), format.normalizePhone(input), enroll.normalizePhone(input), dbOut[i] ?? ''];
  check(`"${input}" → ${want || '(ריק)'}`, got.every((g) => g === want), JSON.stringify(got));
});

console.log('\nנייד תקין:');
check('052… / ‎+9725… / ‎9725… — כולם ניידים תקינים', ['052-123-4567', '+972 52 123 4567', '972521234567'].every((p) => server.isValidIsraeliMobile(p) && enroll.isIsraeliMobile(p)));
check('קווי / קצר — לא נייד', !server.isValidIsraeliMobile('03-1234567') && !enroll.isIsraeliMobile('12345'));

console.log('\nמבנה — מקור אחד:');
const fmt = codeOf('src/lib/format.ts'), enr = codeOf('src/lib/enrollment.ts');
check('★ המסך (format.ts) מייבא את הנרמול מהשרת — בלי עותק', /export \{ normalizePhone \} from '\.\.\/\.\.\/supabase\/functions\/_shared\/phone\.ts'/.test(fmt) && !/function normalizePhone/.test(fmt));
check('★ דף ההרשמה (enrollment.ts) — אותו דבר', /from '\.\.\/\.\.\/supabase\/functions\/_shared\/phone\.ts'/.test(enr) && !/function normalizePhone/.test(enr));
const enrollFn = sql(`select prosrc from pg_proc where proname = 'rpc_enroll'`);
check('★ ההרשמה במסד (rpc_enroll) — דרך f_normalize_phone', /v_phone := f_normalize_phone\(v_phone\);/.test(enrollFn) && !/v_phone ~ '\^0\\d\{9\}\$'/.test(enrollFn));
check('הטלפון של מספרים מורשים — דרך f_normalize_phone (טריגר)', /f_normalize_phone\(new\.phone\)/.test(sql(`select prosrc from pg_proc where proname = 'f_authorized_number_normalize'`)));

console.log(fails === 0 ? '\nנרמול טלפון: הכל עבר' : `\n${fails} בדיקות נכשלו`);
process.exit(fails === 0 ? 0 : 1);
