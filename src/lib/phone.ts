/**
 * נרמול מספרי טלפון לפורמט בינלאומי (E.164), עם ברירת מחדל ישראל.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[^\d+]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  s = s.replace(/\+/g, "");
  if (!s) return null;
  if (s.startsWith("972")) return `+${s}`;
  if (s.startsWith("0")) return `+972${s.slice(1)}`;
  // מספר ישראלי בלי 0 מוביל (למשל 52-1234567)
  if (s.length >= 8 && s.length <= 9) return `+972${s}`;
  return `+${s}`;
}

/** תצוגה נוחה: 052-123-4567 / 03-123-4567 / +1 555... */
export function displayPhone(e164?: string | null): string {
  if (!e164) return "";
  if (e164.startsWith("+972")) {
    const national = `0${e164.slice(4)}`;
    if (national.length === 10) return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
    if (national.length === 9) return `${national.slice(0, 2)}-${national.slice(2, 5)}-${national.slice(5)}`;
    return national;
  }
  return e164;
}

export function isPlausiblePhone(e164?: string | null): boolean {
  if (!e164) return false;
  const digits = e164.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

export function whatsappHref(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, "");
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}
