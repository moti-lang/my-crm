import { useEffect, useState } from 'react';
import { useBranchEnrollmentState, useUpdateBranch, DEFAULT_FORM_OPTIONS, type Branch, type BranchInput, type FormOptions } from '@/hooks/branches';
import { useEnrollmentSettings } from '@/hooks/enrollment';
import { BranchForm, normalizeBranchPhone } from '@/components/BranchForm';
import { PlanEditor, planOk } from '@/components/PlanEditor';
import type { PlanInput } from '@/lib/enrollment';
import { humanError } from '@/lib/errors';

/**
 * הגדרות הסניף (הבעלים): פרטים, קישור הרשמה, פתיחה/סגירה ומכסה, תקנון ומבנה
 * תשלום. כל שינוי חל על הסניף הזה בלבד, ולא משנה לתלמידות שכבר נרשמו
 * (התנאים שלהן שמורים אצלן).
 */
export function BranchSettings({ branch }: { branch: Branch }) {
  const update = useUpdateBranch();
  const state = useBranchEnrollmentState(branch.id);
  const settings = useEnrollmentSettings();
  const [info, setInfo] = useState<BranchInput>({});
  const [plan, setPlan] = useState<PlanInput>({});
  const [terms, setTerms] = useState('');
  const [open, setOpen] = useState(true);
  const [capacity, setCapacity] = useState<string>('');
  const [opts, setOpts] = useState<FormOptions>(DEFAULT_FORM_OPTIONS);
  const [photoText, setPhotoText] = useState('');
  const [collect, setCollect] = useState(true);
  const [program, setProgram] = useState('');
  const [group, setGroup] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setInfo({
      name: branch.name, city: branch.city, address: branch.address, supervisor_name: branch.supervisor_name,
      supervisor_phone: branch.supervisor_phone, schedule_text: branch.schedule_text, weekdays: branch.weekdays,
      lesson_time: branch.lesson_time, age_groups: branch.age_groups,
    });
    setPlan((branch.plan ?? {}) as PlanInput);
    setTerms(branch.terms ?? '');
    setOpen(branch.enrollment_open);
    setCapacity(branch.capacity ? String(branch.capacity) : '');
    setOpts({ ...DEFAULT_FORM_OPTIONS, ...((branch.form_options ?? {}) as Partial<FormOptions>) });
    setPhotoText(branch.photo_consent_text ?? '');
    setCollect(branch.collect_payments);
    setProgram(branch.program_name ?? '');
    setGroup(branch.whatsapp_group_url ?? '');
  }, [branch]);

  const base = settings.data?.base_url || window.location.origin;
  const link = `${base}/enroll/${branch.enroll_token}`;
  const cap = capacity.trim() === '' ? null : Number(capacity);
  const capOk = cap === null || (Number.isInteger(cap) && cap > 0);
  const st = state.data;
  // קישור לקבוצה: רק chat.whatsapp.com (המסד אוכף את אותו כלל).
  const groupOk = group.trim() === '' || /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+\/?$/.test(group.trim());

  async function save() {
    setMsg(null);
    try {
      await update.mutateAsync({
        id: branch.id, ...info, supervisor_phone: normalizeBranchPhone(info.supervisor_phone),
        plan: plan as BranchInput['plan'], terms, enrollment_open: open, capacity: cap,
        form_options: opts, photo_consent_text: photoText,
        collect_payments: collect, program_name: program.trim() || null, whatsapp_group_url: group.trim() || null,
      });
      setMsg('נשמר. השינויים חלים על הרשמות חדשות לסניף הזה בלבד.');
    } catch (e) { setMsg(humanError(e)); }
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3 p-4">
        <h2 className="text-lg">קישור ההרשמה של הסניף</h2>
        <p className="text-sm text-soft">ההורה לא בוחרת סניף: הקישור הזה פותח את דף ההרשמה עם התקנון והמחיר של {branch.name} בלבד.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-field bg-shade px-2 py-1 text-xs" dir="ltr">{link}</code>
          <button type="button" className="btn-ghost px-3 py-1 text-xs"
            onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            {copied ? 'הועתק' : 'העתקה'}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> ההרשמה לסניף פתוחה
          </label>
          <label className="block text-sm">מכסת תלמידות (ריק = בלי מכסה)
            <input type="number" min={1} className="field mt-1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </label>
        </div>
        {st && (
          <p className={`text-sm ${st.open ? 'text-ok' : 'text-bad'}`} role="status">
            {st.open ? 'ההרשמה פתוחה' : st.reason === 'full' ? 'ההרשמה נסגרה: המכסה מלאה' : 'ההרשמה סגורה'}
            {' · '}{st.taken} רשומות{st.capacity ? ` מתוך ${st.capacity}` : ''}
          </p>
        )}
        {!capOk && <p className="text-sm text-bad">המכסה חייבת להיות מספר שלם חיובי.</p>}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg">שאלות בדף ההרשמה</h2>
        <p className="text-sm text-soft">שאלה מוצגת היא חובה. שאלה מוסתרת לא מופיעה בטופס.</p>
        {([
          ['ask_whatsapp', 'האם אתם מקבלים הודעות וואטסאפ? — מי שעונה "לא" לא תקבל תזכורות בוואטסאפ, ובגבייה יופיע "דרוש קשר אחר"'],
          ['ask_photo', 'אישור צילום — התשובה נכתבת לשדה אישור הצילום, שחוסם צירוף להפקה'],
          ['ask_track', 'אופן התשלום — המסלולים שבמבנה התשלום למטה'],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
            <span>{label}</span>
          </label>
        ))}
        {opts.ask_photo && (
          <label className="block text-sm">נוסח אישור הצילום של הסניף (נשמר אצל כל תלמידה כפי שאישרה)
            <textarea className="field mt-1 min-h-[7rem]" value={photoText} onChange={(e) => setPhotoText(e.target.value)} />
          </label>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg">שם החוג וקבוצת וואטסאפ</h2>
        <label className="block text-sm">שם החוג בסניף הזה
          <input className="field mt-1" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="ריק = לא מוצג שם חוג" />
          <span className="mt-0.5 block text-xs text-soft">מופיע בדף ההרשמה, בתקנון (במקום {'{שם החוג}'}), בדף התשלום, בהודעות להורה, בקבלה ובתשובות הסוכן.</span>
        </label>
        <label className="block text-sm">קישור לקבוצת וואטסאפ
          <input className="field mt-1" dir="ltr" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="https://chat.whatsapp.com/..." />
          <span className="mt-0.5 block text-xs text-soft">מוצג ככפתור בסיום ההרשמה, ונשלח בהודעה להורה.</span>
        </label>
        {!groupOk && <p className="text-sm text-bad">הקישור צריך להתחיל ב-https://chat.whatsapp.com/</p>}
        {groupOk && group.trim() && <a href={group.trim()} target="_blank" rel="noopener noreferrer" className="text-sm text-plum underline">בדיקת הקישור ↗</a>}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg">פרטי הסניף</h2>
        <BranchForm value={info} onChange={setInfo} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg">מבנה התשלום של הסניף</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
          <span><span className="font-medium">גביית תשלום דרך המערכת</span>
            <span className="block text-xs text-soft">כבוי = התשלום נגבה בחוץ (מתנ״ס וכד׳): בלי שאלת תשלום וסכומים בהרשמה, בלי קישורי תשלום ותזכורות חוב, והתלמידה פעילה מיד עם תג "תשלום חיצוני".</span></span>
        </label>
        {collect && (<>
          <p className="text-sm text-soft">חל על הרשמות חדשות. תלמידות שכבר נרשמו נשארות על התנאים שאישרו.</p>
          <PlanEditor plan={plan} onChange={setPlan} />
        </>)}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-lg">תקנון הסניף</h2>
        <p className="text-sm text-soft">מוצג במלואו בדף ההרשמה של הסניף. הנוסח שכל הורה אישרה נשמר אצל התלמידה.</p>
        <textarea className="field min-h-[14rem]" value={terms} onChange={(e) => setTerms(e.target.value)} />
      </section>

      {msg && <p className={`text-sm ${msg.startsWith('נשמר') ? 'text-ok' : 'text-bad'}`} role="status">{msg}</p>}
      <button type="button" className="btn-primary" disabled={update.isPending || (collect && !planOk(plan)) || !groupOk || !capOk || !(info.name ?? '').trim() || !terms.trim() || (opts.ask_photo && !photoText.trim())} onClick={() => void save()}>
        {update.isPending ? 'שומרת…' : 'שמירת הגדרות הסניף'}
      </button>
    </div>
  );
}
