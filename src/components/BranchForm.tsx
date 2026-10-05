import type { BranchInput } from '@/hooks/branches';

const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'] as const;

/** פרטי הסניף: שם, מקום, אחראית, ימים ושעות, קבוצות גיל. משמש להוספה ולעריכה. */
export function BranchForm({ value, onChange }: { value: BranchInput; onChange: (v: BranchInput) => void }) {
  const text = (k: 'name' | 'city' | 'address' | 'supervisor_name' | 'supervisor_phone' | 'schedule_text' | 'age_groups', label: string, extra: { dir?: string; placeholder?: string; required?: boolean } = {}) => (
    <label className="block text-sm">{label}
      <input className="field mt-1" dir={extra.dir} placeholder={extra.placeholder} required={extra.required}
        value={(value[k] as string | null | undefined) ?? ''} onChange={(e) => onChange({ ...value, [k]: e.target.value || null })} />
    </label>
  );
  const days = value.weekdays ?? [];
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {text('name', 'שם הסניף', { required: true, placeholder: 'למשל: דרך אמונה - בית שמש' })}
        {text('city', 'עיר')}
        {text('address', 'כתובת')}
        {text('age_groups', 'קבוצות גיל', { placeholder: 'למשל: כיתות ג–ה, ו–ח' })}
        {text('supervisor_name', 'אחראית בסניף')}
        {text('supervisor_phone', 'טלפון האחראית', { dir: 'ltr', placeholder: '05X-XXXXXXX' })}
      </div>
      <fieldset className="text-sm">
        <legend>ימי לימוד</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className={`cursor-pointer rounded-btn border px-3 py-1 ${days.includes(i) ? 'border-plum bg-plum text-white' : 'border-rule'}`}>
              <input type="checkbox" className="sr-only" checked={days.includes(i)}
                onChange={(e) => onChange({ ...value, weekdays: e.target.checked ? [...days, i].sort() : days.filter((x) => x !== i) })} />
              {d}׳
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">שעת השיעור
          <input type="time" className="field mt-1" dir="ltr" value={(value.lesson_time ?? '').slice(0, 5)} onChange={(e) => onChange({ ...value, lesson_time: e.target.value || null })} />
        </label>
        {text('schedule_text', 'ימים ושעות כפי שמוצג להורים', { placeholder: 'למשל: ראשון ורביעי 16:30' })}
      </div>
    </div>
  );
}

/** טלפון ישראלי לפורמט של המסד (972...). ריק נשאר ריק. */
export function normalizeBranchPhone(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  if (!d) return null;
  return d.startsWith('0') ? `972${d.slice(1)}` : d;
}
