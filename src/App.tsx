import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

function Gate() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-sm text-soft">
        טוען…
      </div>
    );
  }
  if (!session) return <Login />;
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4 text-center text-sm text-soft">
        המשתמש מחובר אך אין לו פרופיל במערכת. פני לניהול.
      </div>
    );
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
        <Route path="/productions" element={<Placeholder title="הפקות" round="סבב 8" />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/agent" element={<Placeholder title="סוכן AI" round="סבב 7" />} />
        <Route path="/commands" element={<Placeholder title="פקודות וואטסאפ" round="סבב 6" />} />
        <Route path="/reports" element={<Placeholder title="דוחות" round="סבב 8" />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
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
  );
}
