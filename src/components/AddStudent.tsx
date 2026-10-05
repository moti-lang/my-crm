import { useState, type FormEvent } from 'react';
import { useBranches } from '@/hooks/queries';
import { useBranchTracks, useCreateStudent, type NewStudent } from '@/hooks/branches';
import { humanError } from '@/lib/errors';

/**
 * הוספת תלמידה ידנית, בלי דף ההרשמה. היא מקבלת את תנאי הסניף (שכר לימוד,
 * דמי רישום, תשלומים, תקנון) כמו בהרשמה, ונשמרים אצלה. אין קישור תשלום
 * אוטומטי: את הקישור שולחים מהכרטיס שלה, בכפתור הקיים.
 */
export function AddStudent({ onDone }: { onDone: () => void }) {
  const branches = useBranches();
  const create = useCreateStudent();
  const active = (branches.data ?? []).filter((b) => b.is_active);
  const [v, setV] = useState<NewStudent>({ branch_id: '', first_name: '', last_name: '', status: 'active' });
  const [error, setError] = useState<string | null>(null);
  const branchId = v.branch_id || (active.length === 1 ? active[0]!.id : '');
  const tracks = useBranchTracks(branchId || undefined);
  const text = (k: 'first_name' | 'last_name' | 'grade' | 'school' | 'parent_name' | 'parent_phone' | 'email', label: string, extra: { dir?: string; type?: string; required?: boolean } = {}) => (
    <label className="block text-sm">{label}
      <input className="field mt-1" dir={extra.dir} type={extra.type ?? 'text'} required={extra.required} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </label>
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!branchId) { setError('יש לבחור סניף'); return; }
    if (!v.first_name.trim() || !v.last_name.trim()) { setError('יש למלא שם פרטי ושם משפחה'); return; }
    try { await create.mutateAsync({ ...v, branch_id: branchId }); onDone(); }
    catch (err) { setError(humanError(err)); }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="text-lg">תלמידה חדשה</h2>
      <p className="text-sm text-soft">התלמידה מקבלת את מבנה התשלום והתקנון של הסניף. קישור תשלום שולחים מהכרטיס שלה.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">סניף
          <select className="field mt-1" value={branchId} onChange={(e) => setV({ ...v, branch_id: e.target.value })} required>
            <option value="">בחרי סניף</option>
            {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">סטטוס
          <select className="field mt-1" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as NewStudent['status'] })}>
            <option value="active">פעילה</option>
            <option value="pending">ממתינה</option>
          </select>
        </label>
        {text('first_name', 'שם פרטי', { required: true })}
        {text('last_name', 'שם משפחה', { required: true })}
        {text('grade', 'כיתה')}
        {text('school', 'בית ספר')}
        {text('parent_name', 'שם ההורה')}
        {text('parent_phone', 'טלפון ההורה', { dir: 'ltr', type: 'tel' })}
        {text('email', 'מייל', { dir: 'ltr', type: 'email' })}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-sm">מסלול תשלום
          <select className="field mt-1" value={v.track ?? ''} onChange={(e) => setV({ ...v, track: e.target.value || undefined })}>
            <option value="">לא נבחר</option>
            {(tracks.data ?? []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">מקבלת הודעות וואטסאפ?
          <select className="field mt-1" value={v.whatsapp_opt_in === undefined || v.whatsapp_opt_in === null ? '' : v.whatsapp_opt_in ? 'yes' : 'no'}
            onChange={(e) => setV({ ...v, whatsapp_opt_in: e.target.value === '' ? null : e.target.value === 'yes' })}>
            <option value="">לא נשאלה</option><option value="yes">כן</option><option value="no">לא — דרוש קשר אחר</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input type="checkbox" checked={v.photo_consent ?? false} onChange={(e) => setV({ ...v, photo_consent: e.target.checked })} /> יש אישור צילום
        </label>
      </div>
      <label className="block text-sm">הערות
        <textarea className="field mt-1" value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.mailing_consent ?? false} onChange={(e) => setV({ ...v, mailing_consent: e.target.checked })} /> אישרה הצטרפות לרשימת התפוצה
      </label>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={create.isPending}>{create.isPending ? 'שומרת…' : 'הוספה'}</button>
        <button type="button" className="btn-ghost" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}
