#!/usr/bin/env node
/**
 * מריץ את Prisma CLI עם משתני סביבה מנורמלים:
 * - DATABASE_URL  ← DATABASE_URL | POSTGRES_PRISMA_URL | POSTGRES_URL      (Neon / Supabase / Vercel Storage)
 * - DIRECT_DATABASE_URL ← DIRECT_DATABASE_URL | DATABASE_URL_UNPOOLED | POSTGRES_URL_NON_POOLING | DATABASE_URL
 * שימוש: node scripts/prisma-env.mjs migrate deploy [--if-db]
 *   --if-db  אם אין חיבור למסד נתונים (או שהוא לא זמין) — מדלג באזהרה במקום להפיל את הבנייה
 *            (לבנייה ראשונה ב-Vercel לפני שחיברו DB).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const isPg = (v) => Boolean(v && /^postgres(ql)?:\/\//.test(v));
const entries = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));
const pick = (names, suffixes) => {
  for (const k of names) if (isPg(process.env[k])) return process.env[k];
  for (const suf of suffixes) {
    const hit = entries.find(([k, v]) => k.endsWith(suf) && isPg(v));
    if (hit) return hit[1];
  }
  return "";
};
const url = pick(["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL", "STORAGE_URL", "NEON_DATABASE_URL"], ["_PRISMA_URL", "_URL"]);
const direct = pick(["DIRECT_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING", "STORAGE_URL_UNPOOLED"], ["_URL_UNPOOLED", "_URL_NON_POOLING"]) || url;
if (url) console.log(`[prisma-env] using database from ${entries.find(([, v]) => v === url)?.[0]}`);

const args = process.argv.slice(2);
const ifDb = args.includes("--if-db");
const cleanArgs = args.filter((a) => a !== "--if-db");
const needsDb = ["migrate", "db", "studio"].includes(cleanArgs[0]);

if (needsDb && !url) {
  if (ifDb) {
    console.warn(`[prisma-env] אין DATABASE_URL — מדלג על "prisma ${cleanArgs.join(" ")}". חבר מסד נתונים ב-Vercel (Storage) והרץ Redeploy.`);
    process.exit(0);
  }
  console.error("[prisma-env] DATABASE_URL לא מוגדר.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const prismaBin = require.resolve("prisma/build/index.js");
const r = spawnSync(process.execPath, [prismaBin, ...cleanArgs], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url || "postgresql://unset:unset@localhost:5432/unset", DIRECT_DATABASE_URL: direct || "postgresql://unset:unset@localhost:5432/unset" },
});
if ((r.status ?? 1) !== 0 && ifDb) {
  console.warn(`[prisma-env] "prisma ${cleanArgs.join(" ")}" נכשל (כנראה מסד הנתונים לא זמין) — ממשיכים בבנייה. בדוק את DATABASE_URL ב-Vercel והרץ Redeploy.`);
  process.exit(0);
}
process.exit(r.status ?? 1);
