import { useState } from 'react';
import { formatILS } from '@/lib/format';

/** מצב ההודעה אחרי יצירת קישור — מהמסד (f_link_whatsapp_state). */
export type WhatsappState = 'queued' | 'off' | 'opted_out';

/** מה קרה עם הקישור, באמת: נשלח בוואטסאפ, או שצריך לשלוח אותו בעצמך. */
export function linkResultText(amount: number, whatsapp: WhatsappState | null | undefined): string {
  const made = `הקישור נוצר (${formatILS(amount)})`;
  if (whatsapp === 'queued') return `✓ ${made} ונשלח להורה בוואטסאפ.`;
  if (whatsapp === 'opted_out') return `${made}. ההורה לא מקבלת וואטסאפ — ההודעה לא נשלחה. להעתיק ולשלוח ב-SMS:`;
  return `${made}. שליחת וואטסאפ מהמערכת עדיין לא מופעלת — ההודעה לא נשלחה. להעתיק ולשלוח להורה:`;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* בלי הרשאה — הדרך הישנה */ }
  try {
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch { return false; }
}

/** התוצאה אחרי יצירת קישור: המצב במילים, הקישור עצמו (לסימון ידני בטלפון), העתקה ופתיחה. */
export function LinkResult({ url, amount, whatsapp }: { url: string; amount: number; whatsapp: WhatsappState | null | undefined }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const sent = whatsapp === 'queued';
  return (
    <span className={`block space-y-1 text-xs ${sent ? 'text-ok' : 'text-warn'}`} role="status" data-testid="link-result">
      <span className="block">{linkResultText(amount, whatsapp)}</span>
      <input className="field w-full py-1 text-xs" dir="ltr" readOnly value={url} aria-label="הקישור" onFocus={(e) => e.currentTarget.select()} />
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void copyText(url).then(setCopied)}>
          {copied ? '✓ הועתק' : 'העתקת קישור'}
        </button>
        <a className="underline" href={url} target="_blank" rel="noreferrer">פתיחה</a>
        {copied === false && <span className="text-bad">ההעתקה לא הצליחה — אפשר לסמן את הקישור ולהעתיק ידנית.</span>}
      </span>
    </span>
  );
}
