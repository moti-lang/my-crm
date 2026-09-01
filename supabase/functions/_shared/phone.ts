/** כל טלפון מנורמל ל-972XXXXXXXXX. בלי +, בלי מקפים. */
export function normalizePhone(input: string): string {
  const d = (input ?? '').replace(/\D/g, '');
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

export function isValidIsraeliMobile(phone: string): boolean {
  return /^9725\d{8}$/.test(normalizePhone(phone));
}
