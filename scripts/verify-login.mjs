#!/usr/bin/env node
/**
 * שלב 3 — התחברות אמיתית בשלושת התפקידים מול GoTrue.
 *
 * זו הפעם הראשונה שהמערכת נבדקת עם JWT אמיתי ולא עם claims שהוזרקו
 * ידנית ל-set_config. אם ה-shim הטעה אותנו במשהו, זה ייפול כאן.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const PASSWORD = 'Teichtal!2026';

if (!URL || !ANON) {
  console.error('✗ חסרים SUPABASE_URL או SUPABASE_ANON_KEY');
  process.exit(2);
}

let fails = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
};

const USERS = [
  { email: 'hania@teichtal.local',  role: 'owner',          branches: 5, students: 21 },
  { email: 'beitar@teichtal.local', role: 'branch_manager', branches: 1, students: 6 },
  { email: 'books@teichtal.local',  role: 'accountant',     branches: 5, students: 0 },
];

for (const u of USERS) {
  console.log(`\n${u.email} (${u.role}):`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });

  const { data: auth, error: authErr } = await client.auth.signInWithPassword({
    email: u.email, password: PASSWORD,
  });
  if (authErr) { check('התחברות', false, authErr.message); continue; }
  check('התחברות מוצלחת', Boolean(auth.session?.access_token));

  // ★ ה-JWT האמיתי — לא claims שהוזרקו ידנית
  const claims = JSON.parse(Buffer.from(auth.session.access_token.split('.')[1], 'base64').toString());
  check('ה-JWT נושא sub', Boolean(claims.sub));
  check('ה-sub תואם למשתמש', claims.sub === auth.user.id);
  check(`role בטוקן: ${claims.role}`, claims.role === 'authenticated');

  const { data: profile, error: pErr } = await client
    .from('profiles').select('role, full_name').eq('id', auth.user.id).maybeSingle();
  if (pErr) check('קריאת הפרופיל', false, pErr.message);
  else {
    check('★ profiles_self עובדת מול JWT אמיתי', Boolean(profile));
    check(`התפקיד ${u.role}`, profile?.role === u.role, `התקבל: ${profile?.role}`);
  }

  const { data: branches, error: bErr } = await client.from('branches').select('id');
  if (bErr) check('קריאת סניפים', false, bErr.message);
  else check(`★ רואה ${u.branches} סניפים`, branches.length === u.branches,
             `התקבל: ${branches.length}`);

  const { data: students } = await client.from('students').select('id');
  check(`★ רואה ${u.students} תלמידות בטבלה`, (students?.length ?? 0) === u.students,
        `התקבל: ${students?.length ?? 0}`);

  // ★ עקביות כספית מול JWT אמיתי — הבאג של סבב 3
  if (u.role !== 'branch_manager') {
    const { data: pnl } = await client.from('v_branch_pnl').select('income_students');
    const income = (pnl ?? []).reduce((s, r) => s + Number(r.income_students ?? 0), 0);
    check('★ דוח רווח והפסד מחזיר הכנסות (לא אפס)', income > 0, `התקבל: ${income}`);
  }

  await client.auth.signOut();
}

console.log(fails === 0 ? '\nשלושת התפקידים עובדים מול GoTrue' : `\n${fails} בדיקות נכשלו`);
process.exit(fails ? 1 : 0);
