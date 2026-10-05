/** המסלול שבחרה, "ממתינה למזומן" ו"דרוש קשר אחר" (לא מקבלת וואטסאפ). */
export function StudentTags({ method, label, whatsapp }: { method?: string | null; label?: string | null; whatsapp?: boolean | null }) {
  return (
    <span className="mr-1 inline-flex flex-wrap gap-1 align-middle">
      {method === 'cash' && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] text-warn">ממתינה למזומן</span>}
      {label && method !== 'cash' && <span className="rounded-full bg-shade px-2 py-0.5 text-[11px] text-soft">{label}</span>}
      {whatsapp === false && <span className="rounded-full bg-bad/10 px-2 py-0.5 text-[11px] text-bad" title="ענתה שאינה מקבלת הודעות וואטסאפ">דרוש קשר אחר</span>}
    </span>
  );
}
