// cron-backup — גיבוי יומי של המסד: Storage + מייל.
//
// pg_cron יורה ב-19:00 וב-20:00 UTC; רצים רק כשבישראל 22:00 (?force=1 עוקף).
// הסדר, ואין ממנו חריגה:
//   1. rpc_backup_dump()  — כל המסד, מצד המסד, פורמט teichtal-backup/1.
//   2. העלאה ל-Storage (backups/), ואז הורדה בחזרה ואימות: מה שנשמר באמת
//      נפרס ותואם למניפסט. "הועלה" אינו "ניתן לשחזור".
//   3. מחיקת מה שמעבר ל-30 האחרונים.
//   4. מייל: הקובץ מצורף מתחת ל-20MB, אחרת קישור חתום ל-7 ימים.
//   5. כל כשל → מייל התראה + alertOwner. אין שתיקה. אם גם המייל נכשל —
//      alertOwner נשאר (audit_log + system_alerts + webhook).
//
// הקריאה מוגנת: Authorization חייב להיות CRON_SECRET — סוד ייעודי שמנפיק
// scripts/schedule-backup.mjs. אף אחד אחר לא אמור להפעיל גיבוי ולשלוח מיילים.
import { adminClient } from '../_shared/supabase.ts';
import { env, requireEnv } from '../_shared/env.ts';
import { alertOwner } from '../_shared/alerts.ts';
import { sendMail } from '../_shared/mail.ts';
import {
  BUCKET, KEEP, shouldRunNow, objectName, deliveryPlan, pruneList, verifyBackupText, humanSize, jerusalemDate,
} from '../_shared/backup-core.ts';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** settings.last_backup — מה שמסך ההגדרות מציג. נכתב גם בהצלחה וגם בכשל. */
async function recordRun(db: ReturnType<typeof adminClient>, run: Record<string, unknown>) {
  await db.from('settings').upsert({ key: 'last_backup', value: run }, { onConflict: 'key' });
}

Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${requireEnv('CRON_SECRET')}`) return json({ error: 'unauthorized' }, 401);

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  if (!force && !shouldRunNow()) return json({ skipped: 'לא 22:00 בישראל' });

  const db = adminClient();
  const to = (env('BACKUP_MAIL_TO') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const name = objectName();
  const steps: string[] = [];

  try {
    // ─── 1. dump ───
    const { data, error } = await db.rpc('rpc_backup_dump');
    if (error) throw new Error(`rpc_backup_dump: ${error.message}`);
    const text = JSON.stringify(data);
    const bytes = new TextEncoder().encode(text);
    steps.push(`dump ${humanSize(bytes.length)}`);

    // ─── 2. Storage: העלאה, הורדה בחזרה, אימות ───
    const { data: buckets } = await db.storage.listBuckets();
    if (!(buckets ?? []).some((b) => b.name === BUCKET)) {
      const { error: bErr } = await db.storage.createBucket(BUCKET, { public: false });
      if (bErr) throw new Error(`יצירת bucket: ${bErr.message}`);
    }
    const { error: upErr } = await db.storage.from(BUCKET).upload(name, bytes, { contentType: 'application/json', upsert: false });
    if (upErr) throw new Error(`העלאה: ${upErr.message}`);
    const { data: back, error: dlErr } = await db.storage.from(BUCKET).download(name);
    if (dlErr || !back) throw new Error(`הורדה בחזרה: ${dlErr?.message ?? 'ריק'}`);
    const verified = verifyBackupText(await back.text());
    if (!verified.ok) throw new Error(`הקובץ שנשמר אינו ניתן לשחזור: ${verified.reason}`);
    steps.push(`אומת: ${verified.tables} טבלאות, ${verified.rows} שורות`);

    // ─── 3. שמירת 30 האחרונים ───
    const { data: list } = await db.storage.from(BUCKET).list('', { limit: 1000 });
    const stale = pruneList((list ?? []).map((o) => o.name), KEEP);
    if (stale.length) {
      const { error: rmErr } = await db.storage.from(BUCKET).remove(stale);
      if (rmErr) steps.push(`מחיקת ישנים נכשלה: ${rmErr.message}`); else steps.push(`נמחקו ${stale.length} ישנים`);
    }

    // ─── 4. מייל ───
    const plan = deliveryPlan(bytes.length);
    let link: string | null = null;
    if (plan.mode === 'link') {
      const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUrl(name, 7 * 24 * 3600);
      if (sErr || !signed) throw new Error(`קישור חתום: ${sErr?.message ?? 'ריק'}`);
      link = signed.signedUrl;
    }
    const summary = [
      `גיבוי יומי — ${jerusalemDate()}`,
      `קובץ: ${name} (${humanSize(bytes.length)})`,
      `${verified.tables} טבלאות, ${verified.rows} שורות — הקובץ שנשמר הורד בחזרה ואומת.`,
      `מיגרציות: ${verified.manifest.migrations ?? '—'}`,
      plan.mode === 'attach' ? 'הקובץ מצורף.' : `הקובץ גדול מ-20MB ולכן לא מצורף. קישור (7 ימים): ${link}`,
      `שחזור: npm run restore -- <קובץ> --yes (ראה README).`,
    ].join('\n');

    // המייל מחובר בשלב האחרון לפני מסירה. כל עוד אין BACKUP_MAIL_TO — הגיבוי
    // ל-Storage הוא המוצר, וזה נרשם כמצב ולא כהתראה יומית.
    let mail: Awaited<ReturnType<typeof sendMail>> = { ok: false, error: 'המייל לא מחובר (אין BACKUP_MAIL_TO)' };
    if (to.length) {
      mail = await sendMail({
        to, subject: `גיבוי טייכטל ${jerusalemDate()} — ${verified.rows} שורות`,
        text: summary,
        attachments: plan.mode === 'attach' ? [{ filename: name, content: b64(bytes) }] : undefined,
      });
    }
    if (!mail.ok && to.length) {
      // הגיבוי קיים ב-Storage; רק המייל לא יצא. זה עדיין לא שקט.
      await alertOwner(db, { kind: 'backup_mail_failed', severity: 'warning',
        title: 'הגיבוי נשמר אבל המייל לא יצא', body: `${name}: ${mail.error}`, meta: { name, steps } });
    }
    steps.push(mail.ok ? `מייל נשלח (${plan.mode})` : mail.error);

    // המצב שמסך ההגדרות מציג: מתי, מה, והאם המייל יצא.
    await recordRun(db, { ok: true, at: new Date().toISOString(), name, size: bytes.length,
      tables: verified.tables, rows: verified.rows, mail: mail.ok ? 'sent' : to.length ? 'failed' : 'off', error: null });

    return json({ ok: true, name, size: bytes.length, delivery: plan.mode, mail: mail.ok, steps });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[cron-backup] נכשל', message);
    await alertOwner(db, { kind: 'backup_failed', severity: 'critical',
      title: 'הגיבוי היומי נכשל', body: message, meta: { name, steps } });
    await recordRun(db, { ok: false, at: new Date().toISOString(), name, size: 0, tables: 0, rows: 0,
      mail: to.length ? 'failed' : 'off', error: message }).catch(() => {});
    if (to.length) {
      const m = await sendMail({ to, subject: `⚠️ הגיבוי היומי נכשל — ${jerusalemDate()}`,
        text: `הגיבוי של ${jerusalemDate()} לא הושלם.\n\nשגיאה: ${message}\n\nשלבים שכן רצו: ${steps.join(' · ') || 'אף אחד'}\n\nאין קובץ גיבוי מהיום עד שזה מתוקן.` });
      if (!m.ok) console.error('[cron-backup] גם מייל ההתראה לא יצא', m.error);
    }
    return json({ ok: false, error: message, steps }, 500);
  }
});
