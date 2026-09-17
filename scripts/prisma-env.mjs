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

const url = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || "";
const direct = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || url;

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
