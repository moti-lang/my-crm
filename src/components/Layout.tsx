import { NavLink, Outlet } from 'react-router-dom';
import { useAuth, ROLE_LABEL } from '@/auth/AuthProvider';
import type { Enums } from '@/lib/database.types';

type NavItem = { to: string; label: string; icon: string; roles?: Enums<'user_role'>[] };

const NAV: NavItem[] = [
  { to: '/', label: 'דשבורד', icon: '◆' },
  { to: '/branches', label: 'סניפים', icon: '⌂' },
  { to: '/students', label: 'תלמידות', icon: '☺' },
  { to: '/collection', label: 'גבייה', icon: '₪' },
  { to: '/expenses', label: 'הוצאות', icon: '−' },
  { to: '/general', label: 'כללי', icon: '≡', roles: ['owner', 'accountant'] },
  { to: '/productions', label: 'הפקות', icon: '★' },
  { to: '/attendance', label: 'נוכחות', icon: '✓' },
  { to: '/reminders', label: 'תזכורות', icon: '✉', roles: ['owner'] },
  { to: '/agent', label: 'סוכן AI', icon: '✧', roles: ['owner'] },
  { to: '/commands', label: 'פקודות', icon: '⌘', roles: ['owner'] },
  { to: '/reports', label: 'דוחות', icon: '▤' },
  { to: '/settings', label: 'הגדרות', icon: '⚙', roles: ['owner'] },
];

export function Layout() {
  const { profile, signOut } = useAuth();
  const role = profile?.role;
  const items = NAV.filter((i) => !i.roles || (role && i.roles.includes(role)));

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-3 rounded-btn px-3 py-2 text-sm transition-colors',
      isActive ? 'bg-white/15 text-white font-medium' : 'text-white/70 hover:bg-white/10 hover:text-white',
    ].join(' ');

  return (
    <div className="min-h-screen md:flex">
      {/* דסקטופ — סרגל צד ימני קבוע */}
      <aside className="hidden md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:sticky md:top-0 bg-nav p-3">
        <div className="px-2 pb-4 pt-2">
          <p className="font-display text-base leading-tight text-white">החוג של הניה טייכטל</p>
          <p className="mt-0.5 text-xs text-white/50">מערכת ניהול</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="ניווט ראשי">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={linkClass}>
              <span aria-hidden className="w-4 text-center opacity-70">{i.icon}</span>
              {i.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 pt-3">
          <p className="px-3 text-sm text-white">{profile?.full_name}</p>
          <p className="px-3 text-xs text-white/50">{role ? ROLE_LABEL[role] : ''}</p>
          <button type="button" onClick={signOut} className="mt-2 w-full rounded-btn px-3 py-2 text-right text-sm text-white/70 hover:bg-white/10">
            יציאה
          </button>
        </div>
      </aside>

      {/* מובייל — כותרת עליונה */}
      <header className="flex items-center justify-between bg-nav px-4 py-3 md:hidden">
        <p className="font-display text-sm text-white">החוג של הניה טייכטל</p>
        <button type="button" onClick={signOut} className="text-xs text-white/70">
          יציאה
        </button>
      </header>

      <main className="flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-6">
        <Outlet />
      </main>

      {/* מובייל — סרגל תחתון נגלל אופקית */}
      <nav
        className="fixed bottom-0 inset-x-0 z-20 flex gap-1 overflow-x-auto border-t border-white/10 bg-nav px-2 py-1.5 md:hidden"
        aria-label="ניווט ראשי"
      >
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) =>
              [
                'flex min-w-[4.5rem] shrink-0 flex-col items-center gap-0.5 rounded-btn px-2 py-1.5 text-[11px]',
                isActive ? 'bg-white/15 text-white' : 'text-white/60',
              ].join(' ')
            }
          >
            <span aria-hidden className="text-sm">{i.icon}</span>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
