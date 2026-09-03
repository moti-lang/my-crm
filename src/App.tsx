import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { ErrorBoundary, ConfigError } from '@/components/ErrorBoundary';
import { supabaseConfigError } from '@/lib/supabase';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { NoAccess } from '@/pages/NoAccess';
import { Users } from '@/pages/Users';
import { Dashboard } from '@/pages/Dashboard';
import { Branches } from '@/pages/Branches';
import { BranchDetail } from '@/pages/BranchDetail';
import { Students } from '@/pages/Students';
import { Settings } from '@/pages/Settings';
import { Collection } from '@/pages/Collection';
import { Expenses } from '@/pages/Expenses';
import { General } from '@/pages/General';
import { Attendance } from '@/pages/Attendance';
import { AttendanceSheet } from '@/pages/AttendanceSheet';
import { Reminders } from '@/pages/Reminders';
import { Placeholder } from '@/pages/Placeholder';
import { Productions } from '@/pages/Productions';
import { ProductionDetail } from '@/pages/ProductionDetail';
import { Reports } from '@/pages/Reports';
import { Agent } from '@/pages/Agent';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function Gate() {
  const { session, profile, loading, denied, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-soft">
        טוען…
      </div>
    );
  }
  // אין session: או שעוד לא נכנסה, או שגוגל החזיר אותה עם דחייה מהמסד
  // (האימייל אינו ברשימת המורשים — החשבון לא נוצר בכלל).
  if (!session) return denied ? <NoAccess onSignOut={() => void signOut()} /> : <Login />;
  // יש session אבל אין פרופיל פעיל: הוסרה או הושבתה. ה-RLS כבר חוסם;
  // המסך רק אומר את זה.
  if (!profile || !profile.is_active) {
    return <NoAccess email={session.user.email} onSignOut={() => void signOut()} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/branches" element={<Branches />} />
        <Route path="/branches/:id" element={<BranchDetail />} />
        <Route path="/students" element={<Students />} />
        <Route path="/collection" element={<Collection />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/general" element={<General />} />
        <Route path="/productions" element={<Productions />} />
        <Route path="/productions/:id" element={<ProductionDetail />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/reminders" element={<Reminders />} />
        {profile.role === 'owner' && <Route path="/agent" element={<Agent />} />}
        <Route path="/commands" element={<Placeholder title="פקודות וואטסאפ" round="סבב 6" />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        {/* ניהול משתמשים: הבעלים בלבד. לשאר התפקידים המסלול לא קיים. */}
        {profile.role === 'owner' && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  // הגדרה חסרה נבדקת לפני הכל: אין טעם לנסות לטעון נתונים.
  if (supabaseConfigError) return <ConfigError detail={supabaseConfigError} />;

  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* ציבורי: מסך האחראית. מחוץ ל-AuthProvider בכוונה —
              הוא לא דורש התחברות ולא אמור להמתין לבדיקת session. */}
          <Route path="/a/:token" element={<AttendanceSheet />} />
          <Route
            path="*"
            element={
              <AuthProvider>
                <Gate />
              </AuthProvider>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}
