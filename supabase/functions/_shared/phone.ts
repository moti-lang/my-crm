/**
 * ★ נרמול הטלפון — המקור היחיד במערכת. המסך (src/lib/format.ts, src/lib/enrollment.ts) מייבא
 *   מכאן, וה-SQL (f_normalize_phone) הוא אותו כלל בדיוק — ‏phone-normalize.test.mjs מריץ את
 *   אותה טבלת מקרים על שניהם.
 *
 * הצורה הקבועה: 972XXXXXXXXX — ספרות בלבד, בלי + ובלי 0 אחרי הקידומת.
 *   052-123-4567 · ‎+972 52 123 4567 · ‎972521234567 · ‎00972521234567 · ‎+972-052-1234567
 *   · ‎521234567 · ‎972521234567@s.whatsapp.net  →  972521234567
 * הסיומת של וואטסאפ (@s.whatsapp.net) לא נשמרת אף פעם — היא מתווספת רק בתוך wa.ts.
 */
export function normalizePhone(input: string | null | undefined): string {
  // מזהה וואטסאפ: "972…:12@s.whatsapp.net" — רק החלק שלפני ':' / '@' הוא המספר.
  const raw = String(input ?? '').split('@')[0]!.split(':')[0]!;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);                  // קידומת בינלאומית: 00972…
  if (d.startsWith('9720')) d = `972${d.slice(4)}`;         // ‎+972-052… — ה-0 המקומי נשאר בטעות
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `972${d}`;                 // נייד בלי ה-0: 521234567
  return d;
}

export function isValidIsraeliMobile(phone: string | null | undefined): boolean {
  return /^9725\d{8}$/.test(normalizePhone(phone));
}
