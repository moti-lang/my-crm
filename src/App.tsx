import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { IdleGuard } from '@/auth/IdleGuard';
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
import { Pay } from '@/pages/Pay';
import { Enroll } from '@/pages/Enroll';
import { MailingList } from '@/pages/MailingList';
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
  // החלפת משתמשת (כולל יציאה) מנקה את כל מה שנטען לזיכרון. בלי זה
  // מי שנכנסת אחרי מישהי אחרת באותו טאב רואה לרגע את הנתונים שלה,
  // ואחרי יציאה הם נשארים בזיכרון עד רענון.
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const prevUser = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUser.current !== userId) { queryClient.clear(); prevUser.current = userId; }
  }, [userId, queryClient]);

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
    <>
    <IdleGuard />
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
        {profile.role === 'owner' && <Route path="/mailing" element={<MailingList />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </>
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
          {/* ציבורי: דף התשלום של ההורה. הטוקן הוא ההרשאה; המסד מאמת. */}
          <Route path="/pay/:token" element={<Pay />} />
          {/* ציבורי: דף ההרשמה. RPC אחד, אימות והגבלת קצב במסד. */}
          <Route path="/enroll" element={<Enroll />} />
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
