import { useState, type FormEvent } from 'react';
import { useAuth, ROLE_LABEL } from '@/auth/AuthProvider';
import { useBranches } from '@/hooks/queries';
import {
  useAllowedUsers, useInviteUser, useUpdateAllowedUser, useRemoveAllowedUser,
  allowlistError, type AllowedUser, type UserRole,
} from '@/hooks/users';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { formatDate } from '@/lib/format';

const ROLES: UserRole[] = ['owner', 'branch_manager', 'accountant'];

/**
 * ניהול משתמשים — הבעלים בלבד (המסלול קיים רק לה, ראה App.tsx).
 *
 * המסך כותב רק ל-allowed_users. הפרופיל, השיוך לסניף והכיבוי בפועל
 * נגזרים ממנה בטריגרים במסד. אם המסך הזה ייעלם מחר — הכללים נשארים.
 */
export function Users() {
  const { profile } = useAuth();
  const users = useAllowedUsers();
  const branches = useBranches();
  const update = useUpdateAllowedUser();
  const remove = useRemoveAllowedUser();
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function patch(u: AllowedUser, changes: Parameters<typeof update.mutateAsync>[0]['patch']) {
    setRowError(null);
    try {
      await update.mutateAsync({ id: u.id, patch: changes });
    } catch (e) {
      setRowError({ id: u.id, message: allowlistError(e) });
    }
  }

  async function onRemove(u: AllowedUser) {
    const who = u.full_name || u.email;
    const msg = u.user_id
      ? `להסיר את ${who} מהמערכת? היא לא תוכל להיכנס יותר. הרשומות שיצרה נשארות.`
      : `לבטל את ההזמנה של ${who}?`;
    if (!window.confirm(msg)) return;
    setRowError(null);
    try {
      await remove.mutateAsync(u.id);
    } catch (e) {
      setRowError({ id: u.id, message: allowlistError(e) });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">משתמשים</h1>
        <p className="mt-1 text-sm text-soft">
          הכניסה בגוגל בלבד, ורק לאימייל שברשימה הזו. מוזמנת שטרם נכנסה מסומנת "ממתינה" —
          התפקיד שלה מחכה לה לכניסה הראשונה.
        </p>
      </div>

      <InviteForm invitedBy={profile?.id ?? ''} branches={branches.data ?? []} />

      <section>
        <h2 className="mb-2 text-lg">רשימת המורשים</h2>
        {users.isLoading ? (
          <CardSkeleton rows={4} />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : (users.data?.length ?? 0) === 0 ? (
          <EmptyState title="אין מורשים" hint="הזמיני את הראשונה למעלה." />
        ) : (
          <div className="table-wrap">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-right text-xs text-soft">
                <tr>
                  <th className="px-2 py-2 font-normal">שם</th>
                  <th className="px-2 py-2 font-normal">אימייל</th>
                  <th className="px-2 py-2 font-normal">תפקיד</th>
                  <th className="px-2 py-2 font-normal">סניף</th>
                  <th className="px-2 py-2 font-normal">מצב</th>
                  <th className="px-2 py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {(users.data ?? []).map((u) => {
                  const isMe = u.user_id === profile?.id;
                  const busy = update.isPending || remove.isPending;
                  return (
                    <tr key={u.id} className="border-t border-rule align-top">
                      <td className="px-2 py-2">
                        <span className="font-medium">{u.full_name || <span className="text-soft">— מגוגל</span>}</span>
                        {isMe && <span className="mr-2 text-xs text-soft">(את)</span>}
                        {rowError?.id === u.id && (
                          <p className="mt-1 text-xs text-bad" role="alert">{rowError.message}</p>
                        )}
                      </td>
                      <td className="px-2 py-2" dir="ltr">{u.email}</td>
                      <td className="px-2 py-2">
                        <select
                          className="field py-1"
                          value={u.role}
                          disabled={busy}
                          aria-label={`תפקיד של ${u.email}`}
                          onChange={(e) => void patch(u, { role: e.target.value as UserRole })}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        {u.role === 'branch_manager' ? (
                          <select
                            className="field py-1"
                            value={u.branch_id ?? ''}
                            disabled={busy}
                            aria-label={`סניף של ${u.email}`}
                            onChange={(e) => void patch(u, { branch_id: e.target.value || null })}
                          >
                            <option value="">— בלי סניף —</option>
                            {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-soft">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge u={u} />
                      </td>
                      <td className="px-2 py-2 text-left whitespace-nowrap">
                        {u.user_id && (
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => void patch(u, { is_active: !u.is_active })}
                          >
                            {u.is_active ? 'השבתה' : 'הפעלה'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost mr-1 px-2 py-1 text-xs text-bad"
                          disabled={busy}
                          onClick={() => void onRemove(u)}
                        >
                          {u.user_id ? 'הסרה' : 'ביטול הזמנה'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-soft">
        הזמנה חדשה דורשת גם הוספה של אותו אימייל כ-test user באפליקציית הגוגל של המערכת
        (Google Cloud ← OAuth consent screen ← Test users). בלי זה גוגל חוסם את הכניסה
        עוד לפני שהמערכת רואה אותה.
      </p>
    </div>
  );
}

function StatusBadge({ u }: { u: AllowedUser }) {
  if (!u.user_id) {
    return (
      <span className="rounded-btn border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs text-warn">
        ממתינה · הוזמנה {formatDate(u.invited_at)}
      </span>
    );
  }
  if (!u.is_active) {
    return <span className="rounded-btn border border-bad/40 bg-bad/10 px-2 py-0.5 text-xs text-bad">מושבתת</span>;
  }
  return (
    <span className="rounded-btn border border-ok/40 bg-ok/10 px-2 py-0.5 text-xs text-ok">
      פעילה · נכנסה {u.joined_at ? formatDate(u.joined_at) : ''}
    </span>
  );
}

function InviteForm({ invitedBy, branches }: { invitedBy: string; branches: { id: string; name: string }[] }) {
  const invite = useInviteUser();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('branch_manager');
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (role === 'branch_manager' && !branchId) {
      setError('למנהלת סניף חייבים לבחור סניף.');
      return;
    }
    try {
      await invite.mutateAsync({
        email, full_name: fullName, role, branch_id: branchId || null, invited_by: invitedBy,
      });
      setDone(`${email.trim().toLowerCase()} הוזמנה. אל תשכחי להוסיף אותה כ-test user בגוגל.`);
      setEmail('');
      setFullName('');
      setBranchId('');
    } catch (err) {
      setError(allowlistError(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-4">
      <h2 className="mb-3 text-lg">הזמנה חדשה</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="block text-sm text-ink" htmlFor="inv-email">אימייל (חשבון גוגל)</label>
          <input
            id="inv-email" type="email" required dir="ltr" className="field mt-1"
            value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm text-ink" htmlFor="inv-name">שם (אופציונלי)</label>
          <input
            id="inv-name" type="text" className="field mt-1" placeholder="יילקח מגוגל אם ריק"
            value={fullName} onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-ink" htmlFor="inv-role">תפקיד</label>
          <select id="inv-role" className="field mt-1" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm text-ink" htmlFor="inv-branch">סניף</label>
          <select
            id="inv-branch" className="field mt-1" value={branchId} disabled={role !== 'branch_manager'}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">{role === 'branch_manager' ? '— בחרי סניף —' : '—'}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-bad" role="alert">{error}</p>}
      {done && <p className="mt-3 text-sm text-ok" role="status">{done}</p>}
      <button type="submit" className="btn-primary mt-4" disabled={invite.isPending}>
        {invite.isPending ? 'שומרת…' : 'הזמנה'}
      </button>
    </form>
  );
}
